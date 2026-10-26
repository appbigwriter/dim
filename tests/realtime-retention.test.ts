import Fastify from "fastify";
import { registerInboxRealtime } from "../apps/api/src/inbox-realtime-routes";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import { assignRole } from "../packages/db/src/seed";
import { loadActor } from "../packages/core/src/access";
import {
  inboxRevision,
  runScheduledInboxEscalations,
  boundedInboxActor,
} from "../packages/core/src/realtime";
import { saveEscalationPolicy } from "../packages/core/src/inbox-operations";
import {
  saveRetentionPolicy,
  prepareRetention,
  reviewRetention,
  executeRetention,
} from "../packages/core/src/retention";
import { canonicalHash } from "../packages/contracts/src/audience";
import { erasureProvider } from "../packages/connectors/src/retention";
async function context(f: Awaited<ReturnType<typeof fixture>>) {
  const identity = await insert(f.db, "influencers", {
    organization_id: f.org.id,
    code: randomUUID(),
    slug: randomUUID(),
    public_name: "Person",
    internal_name: "Person",
    type: "human",
    owner_user_id: f.admin,
  });
  const platform = await one(
    f.db,
    "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
  );
  const account = await insert(f.db, "social_accounts", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "channel",
    external_id: randomUUID(),
  });
  const contact = await insert(f.db, "contacts", {
    organization_id: f.org.id,
    display_name: "Private",
  });
  const conversation = await insert(f.db, "conversations", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    social_account_id: account.id,
    contact_id: contact.id,
    external_thread_id: "private-thread",
    sla_due_at: "2020-01-01T00:00:00Z",
  });
  return { identity, account, contact, conversation };
}
test("realtime revision changes only within authorized scope and automated SLA uses a real bounded member", async () => {
  const f = await fixture();
  try {
    const a = await context(f),
      b = await context(f);
    const actor = {
      ...f.actor,
      grants: [
        {
          permission: "inbox.read",
          scopeType: "influencer",
          scopeId: a.identity.id,
        },
      ],
    };
    const before = await scoped(f.db, actor, (tx) => inboxRevision(tx, actor));
    await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: b.conversation.id,
      direction: "incoming",
      body_reference: "not visible",
    });
    assert.equal(
      await scoped(f.db, actor, (tx) => inboxRevision(tx, actor)),
      before,
    );
    await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: a.conversation.id,
      direction: "outgoing",
      body_reference: "private",
    });
    assert.notEqual(
      await scoped(f.db, actor, (tx) => inboxRevision(tx, actor)),
      before,
    );
    const user = randomUUID();
    await f.db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    await insert(f.db, "organization_members", {
      organization_id: f.org.id,
      user_id: user,
      status: "active",
    });
    await assignRole(
      f.db,
      f.org.id,
      user,
      "support",
      "influencer",
      a.identity.id,
    );
    await boundedInboxActor(f.db, user, f.org.id);
    await assert.rejects(
      () => boundedInboxActor(f.db, f.admin, f.org.id),
      /segundo/,
    );
    await f.db.transaction((tx) =>
      saveEscalationPolicy(tx, f.actor, {
        enabled: true,
        after_minutes: 0,
        assigned_to: f.editor,
        execution_user_id: user,
      }),
    );
    assert.equal((await runScheduledInboxEscalations(f.db)).escalated, 1);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT assigned_to FROM custom_dim.conversations WHERE id=$1",
          [b.conversation.id],
        )
      ).assigned_to,
      null,
    );
    assert.equal((await runScheduledInboxEscalations(f.db)).escalated, 0);
    await f.db.query(
      "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
      [f.org.id, user],
    );
    assert.equal((await runScheduledInboxEscalations(f.db)).blocked, 1);
  } finally {
    await f.db.close();
  }
});
test("external erasure freezes evidence-safe plan, requires independent review and exact receipt, and retries only through readback", async () => {
  const f = await fixture();
  try {
    const c = await context(f);
    await assignRole(f.db, f.org.id, f.reviewer, "admin");
    const reviewer = await loadActor(
      f.db,
      f.reviewer,
      f.org.id,
      "aal2",
      randomUUID(),
    );
    const message = await insert(f.db, "messages", {
      organization_id: f.org.id,
      conversation_id: c.conversation.id,
      direction: "incoming",
      body_reference: "private",
    });
    for (const evidence of [false, true]) {
      const file = await insert(f.db, "storage_objects", {
        organization_id: f.org.id,
        influencer_id: c.identity.id,
        bucket: "dim-private",
        object_path: `${f.org.id}/${c.identity.id}/${randomUUID()}`,
        scan_status: "clean",
      });
      await insert(f.db, "message_attachments", {
        organization_id: f.org.id,
        message_id: message.id,
        storage_object_id: file.id,
      });
      if (evidence)
        await insert(f.db, "consent_records", {
          organization_id: f.org.id,
          contact_id: c.contact.id,
          channel: "telegram",
          purpose: "service",
          granted_at: new Date().toISOString(),
          evidence_ref: `https://example.org/${file.object_path}`,
        });
    }
    const parent = await insert(f.db, "operation_jobs", {
      organization_id: f.org.id,
      job_type: "privacy.request",
      subject_id: c.contact.id,
      status: "approved_human",
      payload: { request_type: "erasure", requested_by: f.admin },
      result: {
        decision: "approve",
        reviewed_by: f.reviewer,
        reviewed_at: new Date().toISOString(),
      },
    });
    await f.db.transaction((tx) =>
      saveRetentionPolicy(tx, f.actor, {
        enabled: true,
        destinations: [
          { id: "private-files", kind: "storage", minimum_age_days: 0 },
        ],
      }),
    );
    const planned = await scoped(f.db, f.actor, (tx) =>
      prepareRetention(tx, f.actor, parent.id),
    );
    const job = planned.jobs[0];
    assert.equal(job.payload.plan.targets.length, 1);
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          prepareRetention(tx, f.actor, parent.id),
        )
      ).jobs[0].id,
      job.id,
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          reviewRetention(tx, f.actor, job.id, {
            decision: "approve",
            plan_hash: job.payload.plan_hash,
            reason: "same actor",
          }),
        ),
      /Outro/,
    );
    await scoped(f.db, reviewer, (tx) =>
      reviewRetention(tx, reviewer, job.id, {
        decision: "approve",
        plan_hash: job.payload.plan_hash,
        reason: "Verified immutable evidence exclusion",
      }),
    );
    let calls = 0;
    const adapter = {
      execute: async (_plan: any, expected: any) => {
        calls++;
        return expected;
      },
    };
    const input = {
      expected_receipt_hash: canonicalHash(job.payload.expected_receipt),
    };
    assert.equal(
      (await executeRetention(f.db, f.actor, job.id, input, adapter)).dry_run,
      true,
    );
    assert.equal(calls, 0);
    await executeRetention(
      f.db,
      f.actor,
      job.id,
      { ...input, dry_run: false },
      adapter,
    );
    await executeRetention(
      f.db,
      f.actor,
      job.id,
      { ...input, dry_run: false },
      adapter,
    );
    assert.equal(calls, 1);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT scan_status FROM custom_dim.storage_objects WHERE id=$1",
          [job.payload.plan.targets[0].id],
        )
      ).scan_status,
      "rejected",
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.consent_records")).rows
        .length,
      1,
    );
    const plan = {
        ...job.payload.plan,
        destination: { id: "provider", kind: "provider", minimum_age_days: 0 },
      },
      expected = job.payload.expected_receipt;
    let posted = 0,
      readback = false;
    const gateway = erasureProvider(
      {
        get: async () => ({
          organization_id: f.org.id,
          destination_id: "provider",
          kind: "provider",
          endpoint: "https://executor.example.org/erase",
          token: "server-only",
        }),
        put: async () => {},
      },
      (async (_url: any, opts: any) => {
        if (opts.method === "POST") {
          posted++;
          readback = true;
          return Response.json(expected);
        }
        return readback
          ? Response.json(expected)
          : new Response(null, { status: 404 });
      }) as typeof fetch,
    );
    assert.deepEqual(
      await gateway.execute(plan as any, expected, false),
      expected,
    );
    assert.equal(posted, 1);
    assert.deepEqual(
      await gateway.execute(plan as any, expected, true),
      expected,
    );
    assert.equal(posted, 1);
    readback = false;
    await assert.rejects(
      () => gateway.execute(plan as any, expected, true),
      /nao reenviar/,
    );
    assert.equal(posted, 1);
  } finally {
    await f.db.close();
  }
});

test("SSE delivers actual revision changes, resumes cursor without replay, and closes after access revocation", async () => {
  const f = await fixture(),
    app = Fastify();
  const controllers: AbortController[] = [];
  try {
    const value = await context(f);
    registerInboxRealtime(app, { db: f.db }, async (req) => {
      (req as any).actor = await loadActor(
        f.db,
        f.admin,
        f.org.id,
        "aal2",
        randomUUID(),
      );
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as any,
      url = `http://127.0.0.1:${address.port}/api/v1/inbox/events`;
    const first = new AbortController();
    controllers.push(first);
    const response = await fetch(url, { signal: first.signal });
    assert.match(
      response.headers.get("content-type") || "",
      /text\/event-stream/,
    );
    const reader = response.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    const cursor = initial.match(/id: ([a-f0-9]{64})/)![1];
    assert(!initial.includes("Private"));
    await insert(f.db, "conversation_notes", {
      organization_id: f.org.id,
      conversation_id: value.conversation.id,
      author_id: f.admin,
      note_body: "private note",
    });
    const update = new TextDecoder().decode((await reader.read()).value);
    const next = update.match(/id: ([a-f0-9]{64})/)![1];
    assert.notEqual(next, cursor);
    assert(!update.includes("private note"));
    first.abort();
    await reader.cancel().catch(() => {});
    const second = new AbortController();
    controllers.push(second);
    const resumed = await fetch(url, {
      headers: { "Last-Event-ID": next },
      signal: second.signal,
    });
    const resumedReader = resumed.body!.getReader();
    assert.match(
      new TextDecoder().decode((await resumedReader.read()).value),
      /heartbeat/,
    );
    await f.db.query(
      "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
      [f.org.id, f.admin],
    );
    const revoked = new TextDecoder().decode(
      (await resumedReader.read()).value,
    );
    assert.match(revoked, /access.revoked/);
    second.abort();
    await resumedReader.cancel().catch(() => {});
  } finally {
    controllers.forEach((controller) => controller.abort());
    await app.close();
    await f.db.close();
  }
});
