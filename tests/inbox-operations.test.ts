import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped, hash } from "../packages/core/src/security";
import { normalizeIncoming } from "../packages/core/src/inbox";
import {
  filterInbox,
  saveEscalationPolicy,
  escalateInbox,
  reviewPrivacy,
  executePrivacy,
  retentionPreview,
} from "../packages/core/src/inbox-operations";
import { templateParameters } from "../packages/connectors/src/templates";
import { loadActor } from "../packages/core/src/access";
import { assignRole } from "../packages/db/src/seed";

async function inboxFixture(
  f: Awaited<ReturnType<typeof fixture>>,
  org = f.org.id,
) {
  const identity = await insert(f.db, "influencers", {
    organization_id: org,
    code: randomUUID(),
    slug: randomUUID(),
    public_name: "Identity",
    internal_name: "Identity",
    type: "virtual",
    owner_user_id: f.admin,
  });
  const platform = await one(
    f.db,
    "SELECT id FROM custom_dim.platforms WHERE code='whatsapp'",
  );
  const account = await insert(f.db, "social_accounts", {
    organization_id: org,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "business",
    handle: "123",
    external_id: randomUUID(),
  });
  const contact = await insert(f.db, "contacts", {
    organization_id: org,
    display_name: "Cliente % Especial",
  });
  const conversation = await insert(f.db, "conversations", {
    organization_id: org,
    influencer_id: identity.id,
    social_account_id: account.id,
    contact_id: contact.id,
    external_thread_id: "55110000",
    tags: ["vip"],
    unread_count: 2,
    sla_due_at: "2020-01-01T00:00:00Z",
  });
  return { identity, account, contact, conversation };
}
test("template header media and dynamic buttons match approved definition and reject arbitrary payloads", () => {
  const template = {
    content: {
      components: [
        { type: "HEADER", format: "DOCUMENT" },
        { type: "BODY", text: "Order {{1}}" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "URL", url: "https://example.com/{{1}}" },
            { type: "QUICK_REPLY" },
            { type: "PHONE_NUMBER", phone_number: "123" },
          ],
        },
      ],
    },
  };
  const input = {
    header: { type: "document" as const, id: "123456", filename: "order.pdf" },
    buttons: [
      { index: 0, type: "url" as const, value: "order-1" },
      { index: 1, type: "quick_reply" as const, value: "ack" },
    ],
  };
  const result = templateParameters(template, ["one"], input)!;
  assert.deepEqual(result[0], {
    type: "header",
    parameters: [
      { type: "document", document: { id: "123456", filename: "order.pdf" } },
    ],
  });
  assert.equal(result[2].sub_type, "url");
  assert.equal(result[3].parameters[0].payload, "ack");
  assert.throws(() => templateParameters(template, ["one"]), /mídia/);
  assert.throws(
    () =>
      templateParameters(template, ["one"], {
        ...input,
        header: { type: "image", id: "123456" },
      }),
    /mídia/,
  );
  assert.throws(
    () =>
      templateParameters(template, ["one"], {
        ...input,
        buttons: [...input.buttons, input.buttons[0]],
      }),
    /duplicados/,
  );
  assert.throws(() =>
    templateParameters(template, ["one"], {
      ...input,
      header: { type: "document", id: "https://evil.invalid/file" },
    }),
  );
  assert.throws(
    () =>
      templateParameters(
        {
          content: {
            components: [{ type: "BODY", text: "{{customer_name}}" }],
          },
        },
        [],
      ),
    /nomeados/,
  );
  assert.deepEqual(
    templateParameters(
      {
        content: {
          components: [
            { type: "HEADER", format: "TEXT", text: "Code {{1}}" },
            { type: "BODY", text: "Static" },
          ],
        },
      },
      [],
      { header: { type: "text", text: "123" } },
    )?.[0].parameters,
    [{ type: "text", text: "123" }],
  );
});
test("inbox filters enforce tenant and per-identity scopes before pagination, literal search and idempotent SLA escalation", async () => {
  const f = await fixture();
  try {
    const a = await inboxFixture(f),
      b = await inboxFixture(f);
    await inboxFixture(f, f.other.id);
    const scopedActor = {
      ...f.actor,
      grants: [
        {
          permission: "inbox.read",
          scopeType: "influencer" as const,
          scopeId: a.identity.id,
        },
      ],
    };
    const query = await scoped(f.db, scopedActor, (tx) =>
      filterInbox(tx, scopedActor, {
        channel: "whatsapp",
        tag: "vip",
        unread: "true",
        sla: "overdue",
        search: "%",
        limit: 1,
      }),
    );
    assert.equal(query.total, 1);
    const emptyPage = await scoped(f.db, scopedActor, (tx) =>
      filterInbox(tx, scopedActor, { offset: 50 }),
    );
    assert.equal(emptyPage.total, 1);
    assert.equal(emptyPage.data.length, 0);
    assert.equal(query.data[0].id, a.conversation.id);
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          filterInbox(tx, f.actor, { search: "absent" }),
        )
      ).total,
      0,
    );
    await f.db.transaction((tx) =>
      saveEscalationPolicy(tx, f.actor, {
        enabled: true,
        after_minutes: 0,
        assigned_to: f.editor,
      }),
    );
    assert.equal(
      (await scoped(f.db, f.actor, (tx) => escalateInbox(tx, f.actor)))
        .escalated,
      2,
    );
    assert.equal(
      (await scoped(f.db, f.actor, (tx) => escalateInbox(tx, f.actor)))
        .escalated,
      0,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT assigned_to FROM custom_dim.conversations WHERE id=$1",
          [b.conversation.id],
        )
      ).assigned_to,
      f.editor,
    );
  } finally {
    await f.db.close();
  }
});
test("privacy requires independent MFA review, defaults to preview, preserves immutable consent and blocks uncertain delivery", async () => {
  const f = await fixture();
  try {
    const x = await inboxFixture(f);
    const message = await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: x.conversation.id,
      direction: "incoming",
      body_reference: "private",
      occurred_at: "2020-01-01T00:00:00Z",
    });
    await insert(f.db, "contact_identities", {
      organization_id: f.org.id,
      contact_id: x.contact.id,
      platform_id: x.account.platform_id,
      external_identifier_hash: hash({
        provider: "whatsapp",
        identifier: "55110000",
      }),
    });
    const consent = await insert(f.db, "consent_records", {
      organization_id: f.org.id,
      contact_id: x.contact.id,
      channel: "whatsapp",
      purpose: "marketing",
      granted_at: "2020-01-01T00:00:00Z",
    });
    const job = await insert(f.db, "operation_jobs", {
      organization_id: f.org.id,
      job_type: "privacy.request",
      subject_id: x.contact.id,
      status: "pending_human",
      payload: { request_type: "erasure", requested_by: f.admin },
    });
    const review = {
      decision: "approve",
      reason: "Verified request",
      lawful_basis: "Reviewed erasure; preserve statutory evidence",
      retain_evidence: true,
    };
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          reviewPrivacy(tx, f.actor, job.id, review),
        ),
      /Outro/,
    );
    await assignRole(f.db, f.org.id, f.reviewer, "admin");
    const reviewer = await loadActor(
      f.db,
      f.reviewer,
      f.org.id,
      "aal2",
      randomUUID(),
    );
    await assert.rejects(
      () =>
        scoped(f.db, { ...reviewer, aal: "aal1" }, (tx) =>
          reviewPrivacy(tx, { ...reviewer, aal: "aal1" }, job.id, review),
        ),
      /segundo/,
    );
    await scoped(f.db, reviewer, (tx) =>
      reviewPrivacy(tx, reviewer, job.id, review),
    );
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          executePrivacy(tx, f.actor, job.id, { reason: "preview" }),
        )
      ).dry_run,
      true,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT body_reference FROM custom_dim.messages WHERE id=$1",
          [message.id],
        )
      ).body_reference,
      "private",
    );
    const delivery = await insert(f.db, "operation_jobs", {
      organization_id: f.org.id,
      job_type: "inbox.send",
      subject_id: x.conversation.id,
      status: "uncertain",
    });
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          executePrivacy(tx, f.actor, job.id, {
            reason: "execute",
            dry_run: false,
          }),
        ),
      /Reconcilie/,
    );
    await f.db.query(
      "UPDATE custom_dim.operation_jobs SET status='completed' WHERE id=$1",
      [delivery.id],
    );
    await assert.rejects(
      () =>
        scoped(f.db, { ...f.actor, organizationId: f.other.id }, (tx) =>
          executePrivacy(
            tx,
            { ...f.actor, organizationId: f.other.id },
            job.id,
            { reason: "cross tenant" },
          ),
        ),
      /encontrado/,
    );
    const result = await scoped(f.db, f.actor, (tx) =>
      executePrivacy(tx, f.actor, job.id, {
        reason: "execute",
        dry_run: false,
      }),
    );
    assert.equal(result.external_erasure_required, true);
    const incoming = await insert(f.db, "operation_jobs", {
      organization_id: f.org.id,
      subject_id: x.account.id,
      job_type: "inbox.ingest",
      status: "queued",
      payload: {
        provider: "whatsapp",
        incoming: {
          sender: "55110000",
          thread: "55110000",
          text: "private again",
          id: "new-message",
          date: new Date().toISOString(),
        },
      },
    });
    assert.deepEqual(
      await scoped(f.db, f.actor, (tx) => normalizeIncoming(tx, incoming)),
      { suppressed: true },
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*) AS count FROM custom_dim.contacts WHERE organization_id=$1",
          [f.org.id],
        )
      ).count,
      1,
    );

    assert.equal(
      (
        await one(
          f.db,
          "SELECT body_reference FROM custom_dim.messages WHERE id=$1",
          [message.id],
        )
      ).body_reference,
      null,
    );
    assert.equal(
      (
        await one(f.db, "SELECT status FROM custom_dim.contacts WHERE id=$1", [
          x.contact.id,
        ])
      ).status,
      "erased",
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT id FROM custom_dim.consent_records WHERE id=$1",
          [consent.id],
        )
      ).id,
      consent.id,
    );
    assert.equal(
      (await scoped(f.db, f.actor, (tx) => retentionPreview(tx, f.actor)))
        .candidates.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
