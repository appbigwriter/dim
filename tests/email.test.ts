import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { hash, scoped } from "../packages/core/src/security";
import { queueEmailReply, sendEmailReply } from "../packages/core/src/email";
import { ResendEmail } from "../packages/connectors/src/email";
import { ProviderFailure, type Vault } from "../packages/connectors/src/index";
const domainId = "11111111-1111-4111-8111-111111111111";
const receiptId = "22222222-2222-4222-8222-222222222222";
const config = {
  provider: "resend",
  token: "re_private",
  domain_id: domainId,
  from_email: "influencer@example.org",
};
const recipientAddress = "reader@example.net";
const payload = {
  text: "Approved answer",
  purpose: "marketing",
  email_subject: "A requested update",
};
const health = {
  id: domainId,
  name: "example.org",
  status: "verified",
  capabilities: { sending: "enabled" },
};
function res(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}
async function emailFixture() {
  const f = await fixture();
  const identity = await insert(f.db, "influencers", {
    organization_id: f.org.id,
    code: "MAIL",
    slug: "email",
    public_name: "Email",
    internal_name: "Email",
    type: "human",
    status: "active",
  });
  const platform = await one(
    f.db,
    "SELECT * FROM custom_dim.platforms WHERE code='email'",
  );
  const connector = await one(
    f.db,
    "SELECT * FROM custom_dim.connectors WHERE platform_id=$1",
    [platform.id],
  );
  const account = await insert(f.db, "social_accounts", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "profile",
    external_id: config.from_email,
    account_status: "active",
    integration_status: "connected",
  });
  const integration = await insert(f.db, "account_integrations", {
    organization_id: f.org.id,
    social_account_id: account.id,
    connector_id: connector.id,
    auth_type: "api_key",
    status: "active",
    secret_ref: `dim/${f.org.id}/${account.id}/token`,
  });
  await insert(f.db, "account_capabilities", {
    organization_id: f.org.id,
    social_account_id: account.id,
    capability_code: "send_messages",
    available: true,
    checked_at: new Date().toISOString(),
  });
  const contact = await insert(f.db, "contacts", {
    organization_id: f.org.id,
    display_name: "Consented reader",
    status: "active",
  });
  await insert(f.db, "contact_influencers", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    contact_id: contact.id,
  });
  const recipient = await insert(f.db, "contact_identities", {
    organization_id: f.org.id,
    contact_id: contact.id,
    platform_id: platform.id,
    external_identifier_hash: hash({
      provider: "email",
      identifier: recipientAddress,
    }),
    encrypted_reference: `dim/${f.org.id}/contacts/${contact.id}/email/${randomUUID()}`,
    verification_status: "verified",
  });
  const conversation = await insert(f.db, "conversations", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    contact_id: contact.id,
    social_account_id: account.id,
    external_thread_id: recipient.id,
  });
  const consent = await insert(f.db, "consent_records", {
    organization_id: f.org.id,
    contact_id: contact.id,
    channel: "email",
    purpose: "marketing",
    lawful_basis: "consent",
    evidence_ref: "verified-reader-request",
    granted_at: new Date().toISOString(),
  });
  const vault: Vault = {
    get: async (ref: string): Promise<Record<string, string>> =>
      ref === integration.secret_ref
        ? config
        : ref === recipient.encrypted_reference
          ? { email: recipientAddress }
          : {},
    put: async () => {},
  };
  return {
    ...f,
    identity,
    account,
    integration,
    contact,
    recipient,
    conversation,
    consent,
    vault,
  };
}
test("Resend validates real sender domain and returns a receipt with provider idempotency", async () => {
  const calls: string[] = [];
  const connector = new ResendEmail(config, (async (
    url: any,
    init?: RequestInit,
  ) => {
    calls.push(String(url));
    assert.equal(init?.redirect, "error");
    if (init?.method === "GET") return res(health);
    assert.equal((init?.headers as any)["Idempotency-Key"], "email-key-1");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      from: config.from_email,
      to: [recipientAddress],
      subject: "Requested",
      text: "Answer",
    });
    return res({ id: receiptId });
  }) as typeof fetch);
  assert.equal((await connector.health(config.from_email)).sendMessages, true);
  assert.equal(
    (
      await connector.send({
        destination: config.from_email,
        to: recipientAddress,
        subject: "Requested",
        text: "Answer",
        idempotencyKey: "email-key-1",
      })
    ).externalId,
    receiptId,
  );
  assert.deepEqual(calls, [
    `https://api.resend.com/domains/${domainId}`,
    "https://api.resend.com/emails",
  ]);
  await assert.rejects(() => connector.health("other@example.org"));
  await assert.rejects(() =>
    connector.send({
      destination: config.from_email,
      to: recipientAddress,
      subject: "Bad\r\nBcc: victim@example.org",
      text: "Answer",
      idempotencyKey: "email-key-2",
    }),
  );
});
test("email queue is durable and sender resolves only linked verified recipient from Vault", async () => {
  const f = await emailFixture();
  try {
    const job = await scoped(f.db, f.actor, (tx) =>
      queueEmailReply(
        tx,
        f.actor,
        f.conversation.id,
        {
          text: payload.text,
          purpose: payload.purpose,
          subject: payload.email_subject,
        },
        "email-send-1",
      ),
    );
    assert.equal(job.job_type, "inbox.send");
    assert.equal(job.payload.email_subject, payload.email_subject);
    let sent = 0;
    const fetcher = (async (_url: any, init?: RequestInit) => {
      if (init?.method === "GET") return res(health);
      sent++;
      assert.equal(JSON.parse(String(init?.body)).to[0], recipientAddress);
      return res({ id: receiptId });
    }) as typeof fetch;
    const result = await scoped(f.db, f.actor, (tx) =>
      sendEmailReply(
        tx,
        f.actor,
        f.conversation.id,
        job.payload,
        job.idempotency_key,
        f.vault,
        fetcher,
      ),
    );
    assert.equal(result.externalId, receiptId);
    assert.equal(sent, 1);
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        queueEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          {
            text: "x",
            purpose: "marketing",
            subject: "x",
            to: "victim@example.org",
          },
          "email-send-2",
        ),
      ),
    );
    await f.db.query(
      "UPDATE custom_dim.conversations SET external_thread_id='victim@example.org' WHERE id=$1",
      [f.conversation.id],
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        sendEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          payload,
          "email-send-3",
          f.vault,
          fetcher,
        ),
      ),
    );
    assert.equal(sent, 1);
  } finally {
    await f.db.close();
  }
});
test("consent revoked during domain verification blocks email before provider send", async () => {
  const f = await emailFixture();
  try {
    let sent = 0;
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, async (tx) => {
          const fetcher = (async (_url: any, init?: RequestInit) => {
            if (init?.method === "GET") {
              await insert(tx, "consent_records", {
                organization_id: f.org.id,
                contact_id: f.contact.id,
                channel: "email",
                purpose: "marketing",
                lawful_basis: "consent",
                evidence_ref: "revocation",
                granted_at: new Date().toISOString(),
                revoked_at: new Date().toISOString(),
                supersedes_id: f.consent.id,
              });
              return res(health);
            }
            sent++;
            return res({ id: receiptId });
          }) as typeof fetch;
          return sendEmailReply(
            tx,
            f.actor,
            f.conversation.id,
            payload,
            "email-revoke-1",
            f.vault,
            fetcher,
          );
        }),
      /opt-in/,
    );
    assert.equal(sent, 0);
  } finally {
    await f.db.close();
  }
});
test("email service needs recent incoming; deleted or relinked contacts and changed scope fail closed", async () => {
  const f = await emailFixture();
  try {
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        queueEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          { text: "Service", subject: "Reply", purpose: "service" },
          "email-service-1",
        ),
      ),
    );
    await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: f.conversation.id,
      direction: "incoming",
      body_reference: "Help please",
    });
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          queueEmailReply(
            tx,
            f.actor,
            f.conversation.id,
            { text: "Service", subject: "Reply", purpose: "service" },
            "email-service-2",
          ),
        )
      ).status,
      "queued",
    );
    let sent = 0;
    await assert.rejects(() =>
      scoped(f.db, f.actor, async (tx) =>
        sendEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          payload,
          "email-revoke-2",
          f.vault,
          (async (_url: any, init?: RequestInit) => {
            if (init?.method === "GET") {
              await tx.query(
                "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
                [f.org.id, f.actor.userId],
              );
              return res(health);
            }
            sent++;
            return res({ id: receiptId });
          }) as typeof fetch,
        ),
      ),
    );
    assert.equal(sent, 0);
    await f.db.query(
      "UPDATE custom_dim.contact_influencers SET relationship_status='inactive' WHERE contact_id=$1",
      [f.contact.id],
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        queueEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          { text: "Service", subject: "Reply", purpose: "service" },
          "email-unlinked-1",
        ),
      ),
    );
    await f.db.query(
      "UPDATE custom_dim.contact_influencers SET relationship_status='active' WHERE contact_id=$1",
      [f.contact.id],
    );
    await f.db.query(
      "UPDATE custom_dim.contacts SET status='erased' WHERE id=$1",
      [f.contact.id],
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        queueEmailReply(
          tx,
          f.actor,
          f.conversation.id,
          { text: "Service", subject: "Reply", purpose: "service" },
          "email-service-3",
        ),
      ),
    );
  } finally {
    await f.db.close();
  }
});
test("Resend timeout and missing accepted receipt remain uncertain; no automatic transport retry", async () => {
  for (const send of [
    () => {
      throw new Error("network");
    },
    () => res({}),
    () => res({}, 503),
  ]) {
    const transport = new ResendEmail(config, (async () =>
      send()) as typeof fetch);
    await assert.rejects(
      () =>
        transport.send({
          destination: config.from_email,
          to: recipientAddress,
          subject: "Reply",
          text: "Content",
          idempotencyKey: "email-uncertain",
        }),
      (e: unknown) => e instanceof ProviderFailure && e.kind === "uncertain",
    );
  }
});
