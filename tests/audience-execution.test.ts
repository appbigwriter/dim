import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { audienceFixture } from "./audience-fixture";
import {
  audienceActionHash,
  validateAudienceAction,
  type AudienceAction,
} from "../packages/contracts/src/audience-actions";
import {
  audienceActions,
  type AudienceActions,
} from "../packages/connectors/src/audience-actions";
import { bindAudience, syncAudience } from "../packages/core/src/audience";
import {
  configureAudienceExecutor,
  flushAudienceReceipts,
  importAudienceAction,
  observeAudienceExecutions,
  pollAudienceActions,
  scheduleAudienceExecution,
  enrichAudienceReceipts,
} from "../packages/core/src/audience-execution";
import { scoped } from "../packages/core/src/security";
import { createResource } from "../packages/core/src/resources";
import {
  approve,
  contentVersion,
  schedule,
} from "../packages/core/src/editorial";
import { insert, one } from "../packages/db/src/index";
import { executePublication } from "../apps/worker/src/publication";
import { reschedule } from "../packages/core/src/completion";
import { assignRole } from "../packages/db/src/seed";

const binding = {
  tenant_id: "audience-tenant-a",
  project_id: "audience-project-a",
  persona_id: "persona-a",
};
function actionFor(accountId = randomUUID()): AudienceAction {
  const action: AudienceAction = {
    contractId: "dim.audience-action.v1",
    actionId: "approved-action-1",
    tenantId: binding.tenant_id,
    projectId: binding.project_id,
    personaId: binding.persona_id,
    contextVersion: 1,
    contextHash: audienceFixture().contextHash,
    kind: "publication",
    channel: "telegram",
    targetAccountId: accountId,
    scheduledAt: new Date().toISOString(),
    content: {
      text: "Persona virtual. Publicação aprovada com fontes.",
      title: "Plano Audience",
      mediaAssetIds: [],
      sourceUrls: ["https://source.example.org/evidence"],
      language: "pt-BR",
    },
    approval: {
      approvalId: "approval-1",
      approvedBy: "origin-reviewer",
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
    idempotencyKey: "approved-action-key-1",
    actionHash: "",
  };
  action.actionHash = audienceActionHash(action);
  return action;
}
test("Audience action validates approval/hash/scope and gateway rejects unconfigured or wrong scope before HTTP", async () => {
  const action = actionFor();
  assert.equal(
    validateAudienceAction(action, binding).actionId,
    action.actionId,
  );
  assert.throws(
    () =>
      validateAudienceAction(
        { ...action, content: { ...action.content, text: "changed" } },
        binding,
      ),
    /Hash/,
  );
  assert.throws(
    () => validateAudienceAction(action, { ...binding, tenant_id: "other" }),
    /outro projeto/,
  );
  assert.throws(
    () => validateAudienceAction(action, binding, Date.now() + 86400001),
    /expirada/,
  );
  let calls = 0;
  const gateway = audienceActions(
    {
      get: async () => ({
        actions_url:
          "https://audience.example.org/api/v1/integrations/dim/actions",
        token: "server-only",
        tenant_id: binding.tenant_id,
        allowed_project_ids: JSON.stringify([binding.project_id]),
      }),
      put: async () => {},
    },
    (async (url: any, opts: any) => {
      calls++;
      assert.equal(
        new URL(url).searchParams.get("tenant_id"),
        binding.tenant_id,
      );
      assert.equal(opts.redirect, "error");
      return Response.json(action);
    }) as typeof fetch,
  );
  assert.equal(
    (await gateway.get("org", binding, action.actionId)).actionId,
    action.actionId,
  );
  await assert.rejects(
    () =>
      gateway.get("org", { ...binding, project_id: "wrong" }, action.actionId),
    /escopo/,
  );
  assert.equal(calls, 1);
});

test("approved source action becomes one reviewable version, requires independent review, publishes once and returns durable exact receipt", async () => {
  const f = await fixture();
  try {
    const identity = await scoped(f.db, f.actor, (tx) =>
      createResource(tx, f.actor, "influencers", {
        public_name: "Executor",
        internal_name: "Executor",
        slug: `executor-${randomUUID()}`,
        type: "virtual",
        owner_user_id: f.admin,
      }),
    );
    await scoped(f.db, f.actor, (tx) =>
      bindAudience(tx, f.actor, identity.id, binding),
    );
    await syncAudience(f.db, f.actor, identity.id, async () =>
      audienceFixture(),
    );
    await f.db.query(
      "UPDATE custom_dim.influencers SET status='active' WHERE id=$1",
      [identity.id],
    );
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    const connector = await one(
      f.db,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
      [platform.id],
    );
    await insert(f.db, "identity_disclosures", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      disclosure_type: "synthetic",
      disclosure_text: "Persona virtual",
    });
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "channel",
      account_status: "active",
      integration_status: "connected",
      external_id: "-123",
    });
    await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "bot_token",
      status: "active",
      secret_ref: `dim/${f.org.id}/${account.id}/token`,
      last_tested_at: new Date().toISOString(),
    });
    await insert(f.db, "account_capabilities", {
      organization_id: f.org.id,
      social_account_id: account.id,
      capability_code: "publish_text",
      available: true,
      checked_at: new Date().toISOString(),
    });
    await insert(f.db, "approval_policies", {
      organization_id: f.org.id,
      code: "editorial",
      version: 1,
      resource_type: "content",
    });
    const action = actionFor(account.id);
    const receipts: any[] = [];
    const source: AudienceActions = {
      list: async () => [action],
      get: async () => action,
      receipt: async (_org, _scope, r) => {
        receipts.push(r);
      },
    };
    await assert.rejects(
      () =>
        configureAudienceExecutor(f.db, f.actor, identity.id, true, f.admin),
      /segundo fator/,
    );
    await assignRole(f.db, f.org.id, f.editor, "audience_executor");
    await configureAudienceExecutor(f.db, f.actor, identity.id, true, f.editor);
    assert.equal(
      (await pollAudienceActions(f.db, source, async () => audienceFixture()))
        .imported,
      1,
    );
    const imported = await importAudienceAction(
      f.db,
      f.editActor,
      identity.id,
      action.actionId,
      source,
    );
    assert.equal(imported.status, "awaiting_review");
    assert.equal(
      (
        await importAudienceAction(
          f.db,
          f.editActor,
          identity.id,
          action.actionId,
          source,
        )
      ).replay,
      true,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.content_versions")).rows
        .length,
      1,
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          scheduleAudienceExecution(tx, f.editActor, imported.execution_id),
        ),
      /aprovada/,
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          approve(tx, f.editActor, imported.content_id, {
            content_version_id: imported.content_version_id,
            decision: "approved",
            rationale: "self",
          }),
        ),
      (e: any) => e.code === "FORBIDDEN",
    );
    await scoped(f.db, f.reviewActor, (tx) =>
      approve(tx, f.reviewActor, imported.content_id, {
        content_version_id: imported.content_version_id,
        decision: "approved",
        rationale: "Conferido",
      }),
    );
    await f.db.query(
      "UPDATE custom_dim.audience_bindings SET last_execution_polled_at=now()-interval '2 minutes'",
    );
    assert.equal(
      (await pollAudienceActions(f.db, source, async () => audienceFixture()))
        .scheduled,
      1,
    );
    const job = await scoped(f.db, f.editActor, (tx) =>
      scheduleAudienceExecution(tx, f.editActor, imported.execution_id),
    );
    assert.equal(job.status, "queued");
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          schedule(
            tx,
            f.editActor,
            {
              social_account_id: account.id,
              content_version_id: imported.content_version_id,
              scheduled_at: action.scheduledAt,
            },
            "alternate-action-send-key",
          ),
        ),
      /impedir publicação duplicada/,
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          reschedule(tx, f.editActor, job.id, {
            scheduled_at: new Date(Date.now() + 3600000).toISOString(),
            row_version: job.row_version,
          }),
        ),
      /Horário difere/,
    );
    await f.db.query(
      "UPDATE custom_dim.publication_jobs SET status='publishing' WHERE id=$1",
      [job.id],
    );
    await observeAudienceExecutions(f.db);
    await f.db.query(
      "UPDATE custom_dim.publication_jobs SET status='retry',last_error='RATE_LIMIT' WHERE id=$1",
      [job.id],
    );
    await observeAudienceExecutions(f.db);
    let sent = 0;
    const sender = {
      publish: async () => {
        sent++;
        return { externalId: "confirmed-provider-id" };
      },
      health: async () => ({
        publish: true,
        readMessages: false,
        sendMessages: false,
      }),
    };
    const vault = {
      get: async () => ({ token: "fixture" }),
      put: async () => {},
    };
    await executePublication(f.db, job.id, sender, vault, undefined, source);
    await executePublication(f.db, job.id, sender, vault, undefined, source);
    assert.equal(sent, 1);
    await observeAudienceExecutions(f.db);
    await observeAudienceExecutions(f.db);
    const stored = (
      await f.db.query(
        "SELECT * FROM custom_dim.audience_execution_receipts ORDER BY created_at",
      )
    ).rows;
    assert.deepEqual(
      stored.map((r) => r.status),
      ["awaiting_review", "scheduled", "running", "scheduled", "succeeded"],
    );
    assert.equal(stored[4].receipt.externalId, "confirmed-provider-id");
    assert.equal(
      (
        await flushAudienceReceipts(f.db, {
          ...source,
          receipt: async () => {
            throw new Error("unavailable");
          },
        })
      ).delivered,
      0,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM custom_dim.outbox_events WHERE event_type='audience.receipt' AND processed_at IS NULL",
        )
      ).n,
      5,
    );
    await f.db.query(
      "UPDATE custom_dim.outbox_events SET next_delivery_at=now() WHERE event_type='audience.receipt'",
    );
    assert.equal((await flushAudienceReceipts(f.db, source)).delivered, 5);
    assert.equal((await flushAudienceReceipts(f.db, source)).delivered, 0);
    assert.equal(receipts.length, 5);
    assert.equal(receipts[4].actionHash, action.actionHash);
    await f.db.query(
      "UPDATE custom_dim.publication_jobs SET status='retry' WHERE id=$1",
      [job.id],
    );
    await observeAudienceExecutions(f.db);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT last_status FROM custom_dim.audience_execution_requests WHERE id=$1",
          [imported.execution_id],
        )
      ).last_status,
      "succeeded",
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          scheduleAudienceExecution(tx, f.editActor, imported.execution_id),
        ),
      /já concluída/,
    );
    await assert.rejects(
      () =>
        f.db.query(
          "UPDATE custom_dim.audience_execution_receipts SET status='failed'",
        ),
      /Immutable/,
    );
    await f.db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dim.organization_id',$1,true)", [
        f.other.id,
      ]);
      await tx.query("SET LOCAL ROLE dim_app");
      assert.equal(
        (await tx.query("SELECT * FROM custom_dim.audience_execution_requests"))
          .rows.length,
        0,
      );
    });
    const published = await one(
      f.db,
      "SELECT id FROM custom_dim.published_posts WHERE job_id=$1",
      [job.id],
    );
    const observedAt = new Date().toISOString();
    for (const [metric, value] of [
      ["views", "42"],
      ["comments", "3"],
    ])
      await insert(f.db, "publication_metrics", {
        organization_id: f.org.id,
        published_post_id: published.id,
        metric_code: metric,
        metric_value: value,
        observed_at: observedAt,
        provenance: "test_provider_confirmed",
      });
    await f.db.query(
      "UPDATE custom_dim.published_posts SET metrics_status='available',external_url='https://example.org/post' WHERE id=$1",
      [published.id],
    );
    assert.equal((await enrichAudienceReceipts(f.db)).enriched, 1);
    const enriched = await one(
      f.db,
      "SELECT receipt FROM custom_dim.audience_execution_receipts WHERE execution_id=$1 ORDER BY sequence_no DESC LIMIT 1",
      [imported.execution_id],
    );
    assert.deepEqual(enriched.receipt.metrics, { comments: 3, views: 42 });
    assert.equal(enriched.receipt.metricsObservedAt, observedAt);
    assert.deepEqual(enriched.receipt.evidenceUrls, [
      "https://example.org/post",
    ]);
    assert.equal((await enrichAudienceReceipts(f.db)).enriched, 0);
    const changed = {
      ...action,
      content: { ...action.content, text: "another text" },
    };
    changed.actionHash = audienceActionHash(changed);
    await assert.rejects(
      () =>
        importAudienceAction(f.db, f.editActor, identity.id, action.actionId, {
          ...source,
          get: async () => changed,
        }),
      /outro conteúdo/,
    );
    await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, imported.content_id, {
        body_text: action.content.text,
        language: "pt-BR",
        format: "text",
        source_urls: action.content.sourceUrls,
      }),
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          scheduleAudienceExecution(tx, f.editActor, imported.execution_id),
        ),
      (error: any) => error.code === "AUDIENCE_EXECUTION_FINISHED",
    );
    // Generic scheduling cannot bypass the exact source version requirement either.
    const latest = await one(
      f.db,
      "SELECT * FROM custom_dim.content_versions ORDER BY version_number DESC LIMIT 1",
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.reviewActor, (tx) =>
          approve(tx, f.reviewActor, imported.content_id, {
            content_version_id: latest.id,
            decision: "approved",
            rationale: "Changed",
          }),
        ),
      /nova ação aprovada/,
    );
  } finally {
    await f.db.close();
  }
});
