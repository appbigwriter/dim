import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { buildApp } from "../apps/api/src/app";
import { normalizeIncoming } from "../packages/core/src/inbox";
test("one WhatsApp callback routes phone numbers to their own tenants and deduplicates delivery events", async () => {
  const f = await fixture();
  const previous = process.env.WHATSAPP_APP_SECRET;
  process.env.WHATSAPP_APP_SECRET = "test-signing-key";
  const app = await buildApp({ db: f.db, authenticate: async () => f.actor });
  try {
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='whatsapp'",
    );
    const accounts: any[] = [];
    for (const [org, phone] of [
      [f.org, "111"],
      [f.other, "222"],
    ] as const) {
      const identity = await insert(f.db, "influencers", {
        organization_id: org.id,
        code: phone,
        slug: `phone-${phone}`,
        public_name: phone,
        internal_name: phone,
        type: "human",
      });
      accounts.push(
        await insert(f.db, "social_accounts", {
          organization_id: org.id,
          influencer_id: identity.id,
          platform_id: platform.id,
          account_type: "business_phone",
          external_id: phone,
        }),
      );
    }
    const contact = await insert(f.db, "contacts", {
      organization_id: f.org.id,
      display_name: "Recipient",
    });
    const conversation = await insert(f.db, "conversations", {
      organization_id: f.org.id,
      contact_id: contact.id,
      influencer_id: accounts[0].influencer_id,
      social_account_id: accounts[0].id,
      external_thread_id: "recipient",
    });
    const message = await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: conversation.id,
      provider_message_id: "wamid-test",
      direction: "outgoing",
      status: "sent",
    });
    const payload = {
      entry: [
        {
          id: "waba",
          changes: accounts.map((account, i) => ({
            value: {
              metadata: { phone_number_id: account.external_id },
              messages: [
                {
                  id: `incoming-${i}`,
                  from: `555${i}`,
                  text: { body: "Hello" },
                  timestamp: String(Math.floor(Date.now() / 1000)),
                },
              ],
              ...(i === 0
                ? {
                    statuses: [
                      {
                        id: "wamid-test",
                        status: "read",
                        timestamp: String(Math.floor(Date.now() / 1000)),
                      },
                    ],
                  }
                : {}),
            },
          })),
        },
      ],
    };
    const raw = JSON.stringify(payload),
      signature = `sha256=${createHmac("sha256", "test-signing-key").update(raw).digest("hex")}`;
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/webhooks/whatsapp",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signature,
          "x-organization-id": f.other.id,
        },
        payload: raw,
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.webhook_events")).rows.length,
      3,
    );
    const jobs = (
      await f.db.query(
        "SELECT * FROM custom_dim.operation_jobs WHERE job_type='inbox.ingest'",
      )
    ).rows;
    assert.equal(jobs.length, 3);
    for (const job of jobs)
      await f.db.transaction((tx) => normalizeIncoming(tx, job));
    assert.equal(
      (
        await one(f.db, "SELECT status FROM custom_dim.messages WHERE id=$1", [
          message.id,
        ])
      ).status,
      "read",
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM custom_dim.messages WHERE organization_id=$1 AND direction='incoming'",
          [f.other.id],
        )
      ).rows.length,
      1,
    );
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/whatsapp",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=bad",
      },
      payload: raw,
    });
    assert.equal(invalid.statusCode, 401);
  } finally {
    if (previous === undefined) delete process.env.WHATSAPP_APP_SECRET;
    else process.env.WHATSAPP_APP_SECRET = previous;
    await app.close();
    await f.db.close();
  }
});
