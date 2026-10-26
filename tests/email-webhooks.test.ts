import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import {
  emailDeliveryFacts,
  ingestEmailWebhook,
  processEmailWebhook,
  verifyResendWebhook,
} from "../packages/core/src/email-webhooks";
import { scoped } from "../packages/core/src/security";
import type { Vault } from "../packages/connectors/src/index";
const domainId = "11111111-1111-4111-8111-111111111111";
const incomingId = "22222222-2222-4222-8222-222222222222";
const outgoingId = "33333333-3333-4333-8333-333333333333";
const webhookSecret = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
function signed(
  type: string,
  emailId = incomingId,
  eventId = `msg_${randomUUID()}`,
) {
  const raw = Buffer.from(
    JSON.stringify({
      type,
      created_at: new Date().toISOString(),
      data: { email_id: emailId, from: "untrusted-payload@example.org" },
    }),
  );
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    raw,
    headers: {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${createHmac(
        "sha256",
        Buffer.from(webhookSecret.slice(6), "base64"),
      )
        .update(`${eventId}.${timestamp}.`)
        .update(raw)
        .digest("base64")}`,
    },
  };
}
async function setup() {
  const f = await fixture();
  const identity = await insert(f.db, "influencers", {
    organization_id: f.org.id,
    code: "EMAIL-IN",
    slug: "email-in",
    public_name: "Email",
    internal_name: "Email",
    type: "human",
    status: "active",
  });
  const platform = await one(
    f.db,
    "SELECT id FROM custom_dim.platforms WHERE code='email'",
  );
  const connector = await one(
    f.db,
    "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
    [platform.id],
  );
  const account = await insert(f.db, "social_accounts", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "profile",
    external_id: "influencer@example.org",
    account_status: "active",
    integration_status: "connected",
  });
  const ref = `dim/${f.org.id}/${account.id}/resend`;
  await insert(f.db, "account_integrations", {
    organization_id: f.org.id,
    social_account_id: account.id,
    connector_id: connector.id,
    auth_type: "api_key",
    status: "active",
    secret_ref: ref,
  });
  const entries = new Map<string, Record<string, string>>([
    [
      ref,
      {
        provider: "resend",
        token: "private-api-key",
        domain_id: domainId,
        from_email: account.external_id,
        webhook_secret: webhookSecret,
      },
    ],
  ]);
  const vault: Vault = {
    get: async (path) => ({ ...entries.get(path) }),
    put: async (path, values) => {
      entries.set(path, values);
    },
  };
  return { ...f, identity, account, vault };
}
test("Svix verifier passes official published vector and rejects altered bytes, stale timestamps and unsigned requests", () => {
  const raw = Buffer.from('{"event_type":"ping","data":{"success":true}}');
  const headers = {
    "svix-id": "msg_loFOjxBNrRLzqYUf",
    "svix-timestamp": "1731705121",
    "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
  };
  assert.equal(
    verifyResendWebhook(
      raw,
      headers,
      "whsec_plJ3nmyCDGBKInavdOK15jsl",
      1731705121000,
    ),
    headers["svix-id"],
  );
  assert.throws(() =>
    verifyResendWebhook(
      Buffer.concat([raw, Buffer.from(" ")]),
      headers,
      "whsec_plJ3nmyCDGBKInavdOK15jsl",
      1731705121000,
    ),
  );
  assert.throws(() =>
    verifyResendWebhook(
      raw,
      headers,
      "whsec_plJ3nmyCDGBKInavdOK15jsl",
      1731706121000,
    ),
  );
  assert.throws(() => verifyResendWebhook(raw, {}, webhookSecret));
});
test("signed received event is queued once, read back from Resend, destination-bound and never auto-verifies From", async () => {
  const f = await setup();
  try {
    const request = signed("email.received");
    assert.equal(
      (
        await ingestEmailWebhook(
          f.db,
          f.account.id,
          request.raw,
          request.headers,
          f.vault,
        )
      ).replay,
      false,
    );
    assert.equal(
      (
        await ingestEmailWebhook(
          f.db,
          f.account.id,
          request.raw,
          request.headers,
          f.vault,
        )
      ).replay,
      true,
    );
    await assert.rejects(() =>
      ingestEmailWebhook(
        f.db,
        f.account.id,
        request.raw,
        { ...request.headers, "svix-signature": "v1,invalid" },
        f.vault,
      ),
    );
    const job = await one(
      f.db,
      "SELECT * FROM custom_dim.operation_jobs WHERE job_type='email.webhook'",
    );
    assert.equal(
      JSON.stringify(job.payload).includes("untrusted-payload"),
      false,
    );
    const fetcher = (async (url: any) =>
      String(url).includes("/domains/")
        ? Response.json({
            id: domainId,
            name: "example.org",
            status: "verified",
            capabilities: { receiving: "enabled" },
          })
        : Response.json({
            id: incomingId,
            from: "Reader <reader@example.net>",
            to: [f.account.external_id],
            text: "Help requested",
            subject: "Support",
            html: "<script>ignored</script>",
            authentication: { dmarc: "pass", dkim: "pass" },
          })) as typeof fetch;
    const result = await f.db.transaction((tx) =>
      processEmailWebhook(tx, job, f.vault, fetcher),
    );
    assert.equal(result.sender_verified, false);
    assert.equal(result.authenticated, true);
    const contact = await one(
      f.db,
      "SELECT * FROM custom_dim.contact_identities",
    );
    assert.equal(contact.verification_status, "unverified");
    assert.equal(
      (await f.vault.get(contact.encrypted_reference)).email,
      "reader@example.net",
    );
    const message = await one(f.db, "SELECT * FROM custom_dim.messages");
    assert.equal(message.message_type, "email_authenticated");
    assert.equal(message.body_reference.includes("<script>"), false);
    assert.equal(
      (
        await f.db.transaction((tx) =>
          processEmailWebhook(tx, job, f.vault, fetcher),
        )
      ).replay,
      true,
    );
    await f.db.query(
      "UPDATE custom_dim.contacts SET status='erased' WHERE id=$1",
      [contact.contact_id],
    );
    const secondId = randomUUID(),
      next = signed("email.received", secondId);
    await ingestEmailWebhook(
      f.db,
      f.account.id,
      next.raw,
      next.headers,
      f.vault,
    );
    const nextJob = await one(
      f.db,
      "SELECT * FROM custom_dim.operation_jobs WHERE job_type='email.webhook' AND payload->>'email_id'=$1",
      [secondId],
    );
    assert.equal(
      (
        await f.db.transaction((tx) =>
          processEmailWebhook(tx, nextJob, f.vault, (async (url: any) =>
            String(url).includes("/domains/")
              ? Response.json({
                  id: domainId,
                  name: "example.org",
                  status: "verified",
                  capabilities: { receiving: "enabled" },
                })
              : Response.json({
                  id: secondId,
                  from: "reader@example.net",
                  to: [f.account.external_id],
                  text: "Suppressed",
                })) as typeof fetch),
        )
      ).suppressed,
      true,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM custom_dim.messages")).n,
      1,
    );
  } finally {
    await f.db.close();
  }
});
test("provider readback for foreign recipient rejects even a signed event; delivery and bounce record only owned outgoing facts", async () => {
  const f = await setup();
  try {
    const incoming = signed("email.received");
    await ingestEmailWebhook(
      f.db,
      f.account.id,
      incoming.raw,
      incoming.headers,
      f.vault,
    );
    const badJob = await one(
      f.db,
      "SELECT * FROM custom_dim.operation_jobs WHERE job_type='email.webhook'",
    );
    await assert.rejects(
      () =>
        f.db.transaction((tx) =>
          processEmailWebhook(tx, badJob, f.vault, (async (url: any) =>
            String(url).includes("domains")
              ? Response.json({
                  id: domainId,
                  name: "example.org",
                  status: "verified",
                  capabilities: { receiving: "enabled" },
                })
              : Response.json({
                  id: incomingId,
                  from: "reader@example.net",
                  to: ["another@example.org"],
                })) as typeof fetch),
        ),
      /outra conta/,
    );
    assert.equal(
      (await one(f.db, "SELECT count(*)::int AS n FROM custom_dim.contacts")).n,
      0,
    );
    const contact = await insert(f.db, "contacts", {
      organization_id: f.org.id,
    });
    const conversation = await insert(f.db, "conversations", {
      organization_id: f.org.id,
      influencer_id: f.identity.id,
      social_account_id: f.account.id,
      contact_id: contact.id,
    });
    const message = await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: conversation.id,
      provider_message_id: outgoingId,
      direction: "outgoing",
      status: "sent",
    });
    for (const type of ["email.delivered", "email.bounced", "email.sent"]) {
      const request = signed(type, outgoingId);
      await ingestEmailWebhook(
        f.db,
        f.account.id,
        request.raw,
        request.headers,
        f.vault,
      );
      const job = await one(
        f.db,
        "SELECT * FROM custom_dim.operation_jobs WHERE job_type='email.webhook' AND payload->>'type'=$1",
        [type],
      );
      await f.db.transaction((tx) =>
        processEmailWebhook(tx, job, f.vault, (async () =>
          Response.json({
            id: outgoingId,
            from: f.account.external_id,
            to: ["reader@example.net"],
          })) as typeof fetch),
      );
    }
    assert.equal(
      (
        await one(f.db, "SELECT status FROM custom_dim.messages WHERE id=$1", [
          message.id,
        ])
      ).status,
      "failed",
    );
    const facts = await scoped(f.db, f.actor, (tx) =>
      emailDeliveryFacts(tx, f.actor, f.identity.id),
    );
    assert.equal(facts.observed.length, 3);
    assert.equal(
      facts.observed.find((row) => row.event === "email.delivered")?.messages,
      1,
    );
    assert.equal(facts.missing_events_are_unknown, true);
    const foreign = signed("email.received");
    await assert.rejects(() =>
      ingestEmailWebhook(
        f.db,
        randomUUID(),
        foreign.raw,
        foreign.headers,
        f.vault,
      ),
    );
  } finally {
    await f.db.close();
  }
});
