import { randomUUID } from "node:crypto";
import { demand, type Actor } from "../../contracts/src/index";
import { canonicalHash } from "../../contracts/src/audience";
import {
  validateAudienceAction,
  audienceReceipt,
  type AudienceReceipt,
} from "../../contracts/src/audience-actions";
import type { AudienceActions } from "../../connectors/src/audience-actions";
import { insert, one, type DB, type Database } from "../../db/src/index";
import { audit, authorize, resource, scoped } from "./security";
import { loadActor } from "./access";
import { audienceBlockers, syncAudience } from "./audience";
import type { AudienceProvider } from "../../connectors/src/audience";
import { createResource } from "./resources";
import { contentVersion, schedule } from "./editorial";
import { queueAudienceOperation } from "./audience-operations";

export async function executionReceipt(
  db: DB,
  execution: any,
  status: AudienceReceipt["status"],
  result: Partial<
    Pick<
      AudienceReceipt,
      | "externalId"
      | "errorCode"
      | "metrics"
      | "cost"
      | "evidenceUrls"
      | "metricsProvenance"
      | "metricsObservedAt"
    >
  > = {},
) {
  const current = await one(
    db,
    "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 FOR UPDATE",
    [execution.id],
  );
  const previous = await one(
    db,
    "SELECT * FROM custom_dim.audience_execution_receipts WHERE execution_id=$1 ORDER BY sequence_no DESC LIMIT 1",
    [execution.id],
  );
  if (
    previous &&
    ["succeeded", "cancelled"].includes(current.last_status) &&
    status !== current.last_status
  )
    return previous.receipt;
  const {
    receiptId: _receiptId,
    actionId: _actionId,
    actionHash: _actionHash,
    status: _status,
    occurredAt: _occurredAt,
    ...previousResult
  } = previous?.receipt || {};
  if (
    previous?.status === status &&
    canonicalHash(previousResult) === canonicalHash(result)
  )
    return previous.receipt;
  const stateHash = canonicalHash({
    status,
    ...result,
    previous_receipt_id: previous?.id || null,
  });
  const receipt: AudienceReceipt = audienceReceipt.parse({
    receiptId: randomUUID(),
    actionId: execution.action_id,
    actionHash: execution.action_hash,
    status,
    occurredAt: new Date().toISOString(),
    ...result,
  });
  await insert(db, "audience_execution_receipts", {
    id: receipt.receiptId,
    organization_id: execution.organization_id,
    execution_id: execution.id,
    sequence_no: (previous?.sequence_no || 0) + 1,
    status,
    state_hash: stateHash,
    receipt,
  });
  await db.query(
    "UPDATE custom_dim.audience_execution_requests SET last_status=$1 WHERE id=$2",
    [status, execution.id],
  );
  await insert(db, "outbox_events", {
    organization_id: execution.organization_id,
    event_type: "audience.receipt",
    event_id: randomUUID(),
    aggregate_id: execution.id,
    correlation_id: randomUUID(),
    payload: { receipt_id: receipt.receiptId },
  });
  return receipt;
}

export async function importAudienceAction(
  db: Database,
  actor: Actor,
  influencerId: string,
  actionId: string,
  provider: AudienceActions,
  automatic = false,
) {
  const binding = await scoped(db, actor, async (tx) => {
    await resource(tx, "influencers", influencerId, actor);
    authorize(actor, "editorial.write", { influencerId });
    const b = await one(
      tx,
      "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1",
      [influencerId],
    );
    demand(
      b,
      "AUDIENCE_BINDING_REQUIRED",
      "Vincule o Audience antes de importar ações",
      409,
    );
    return b;
  });
  const mapping = {
    tenant_id: binding.tenant_id,
    project_id: binding.project_id,
    persona_id: binding.persona_id,
  };
  // Always read the approved action from the configured source. The caller only supplies its ID.
  const action = validateAudienceAction(
    await provider.get(actor.organizationId, mapping, actionId),
    mapping,
  );
  demand(
    action.actionId === actionId,
    "AUDIENCE_ACTION_ID",
    "A origem retornou outra ação",
    409,
  );
  const fresh = await loadActor(
    db,
    actor.userId,
    actor.organizationId,
    actor.aal,
    actor.correlationId,
  );
  return scoped(db, fresh, async (tx) => {
    authorize(fresh, "editorial.write", { influencerId });
    await tx.query(
      "SELECT id FROM custom_dim.influencers WHERE id=$1 FOR UPDATE",
      [influencerId],
    );
    const identity = await resource(tx, "influencers", influencerId, fresh);
    const current = await one(
      tx,
      "SELECT b.*,c.context_version,c.context_hash FROM custom_dim.audience_bindings b LEFT JOIN custom_dim.audience_context_versions c ON c.id=b.current_context_id WHERE b.id=$1 FOR UPDATE OF b",
      [binding.id],
    );
    demand(
      !automatic ||
        (current?.execution_enabled &&
          current.executor_user_id === fresh.userId),
      "AUDIENCE_EXECUTOR_DISABLED",
      "Execução automática desativada ou responsável alterado",
      409,
    );
    demand(
      current && !(await audienceBlockers(tx, identity)).length,
      "AUDIENCE_CONTEXT_REQUIRED",
      "Sincronize o contexto aprovado do Audience",
      409,
    );
    const old = await one(
      tx,
      "SELECT * FROM custom_dim.audience_execution_requests WHERE binding_id=$1 AND (action_id=$2 OR idempotency_key=$3)",
      [binding.id, action.actionId, action.idempotencyKey],
    );
    if (old) {
      demand(
        old.action_id === action.actionId &&
          old.action_hash === action.actionHash &&
          old.idempotency_key === action.idempotencyKey,
        "AUDIENCE_ACTION_CONFLICT",
        "Ação ou chave já recebida com outro conteúdo",
        409,
      );
      return {
        execution_id: old.id,
        content_id: old.content_id,
        content_version_id: old.content_version_id,
        status: old.last_status,
        replay: true,
      };
    }
    demand(
      current.context_version === action.contextVersion &&
        current.context_hash === action.contextHash,
      "AUDIENCE_ACTION_STALE",
      "Ação foi aprovada para outro contexto",
      409,
    );
    const account =
      action.kind !== "crm_update"
        ? await resource(tx, "social_accounts", action.targetAccountId!, fresh)
        : null;
    if (account)
      authorize(fresh, "accounts.read", {
        influencerId,
        accountId: account.id,
      });
    const platform = await one(
      tx,
      "SELECT code FROM custom_dim.platforms WHERE id=$1",
      [account?.platform_id || null],
    );
    demand(
      action.kind === "crm_update" ||
        (account?.influencer_id === influencerId &&
          platform?.code ===
            (action.channel === "blog" ? "cms" : action.channel)),
      "AUDIENCE_ACTION_ACCOUNT",
      "Conta ou canal não pertence ao vínculo",
      409,
    );
    const content = await createResource(tx, fresh, "contents", {
      influencer_id: influencerId,
      title: action.content.title || `Audience: ${action.actionId}`,
      objective: "Executar ação aprovada no Audience Builder",
      content_type: action.channel === "blog" ? "article" : "text",
    });
    const version = await contentVersion(tx, fresh, content.id, {
      body_text: action.content.text,
      language: action.content.language,
      format: action.channel === "blog" ? "article" : "text",
      source_urls: action.content.sourceUrls,
      asset_ids: action.content.mediaAssetIds,
      body: {
        audience_action_id: action.actionId,
        audience_action_hash: action.actionHash,
        title: action.content.title,
        ...(action.content.video || {}),
        audience_action_kind: action.kind,
        ...(action.message ? { message: action.message } : {}),
        ...(action.crm ? { crm: action.crm } : {}),
      },
    });
    const execution = await insert(tx, "audience_execution_requests", {
      organization_id: fresh.organizationId,
      influencer_id: influencerId,
      binding_id: binding.id,
      context_id: current.current_context_id,
      action_id: action.actionId,
      action_hash: action.actionHash,
      idempotency_key: action.idempotencyKey,
      action,
      content_id: content.id,
      content_version_id: version.id,
      social_account_id: account?.id,
      requested_by: fresh.userId,
      automatic,
    });
    await executionReceipt(tx, execution, "awaiting_review");
    await audit(
      tx,
      fresh,
      "audience_action_imported",
      "influencers",
      influencerId,
      {
        execution_id: execution.id,
        action_id: action.actionId,
        action_hash: action.actionHash,
      },
    );
    return {
      execution_id: execution.id,
      content_id: content.id,
      content_version_id: version.id,
      status: "awaiting_review",
      replay: false,
    };
  });
}

export async function scheduleAudienceExecution(
  db: DB,
  actor: Actor,
  executionId: string,
) {
  let execution = await resource(
    db,
    "audience_execution_requests",
    executionId,
    actor,
  );
  authorize(actor, "publication.write", {
    influencerId: execution.influencer_id,
    accountId: execution.social_account_id,
  });
  execution = await one(
    db,
    "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 FOR UPDATE",
    [execution.id],
  );
  demand(
    !["succeeded", "cancelled"].includes(execution.last_status),
    "AUDIENCE_EXECUTION_FINISHED",
    "Ação já concluída ou cancelada",
    409,
  );
  const binding = await one(
    db,
    "SELECT * FROM custom_dim.audience_bindings WHERE id=$1",
    [execution.binding_id],
  );
  const action = validateAudienceAction(execution.action, {
    tenant_id: binding.tenant_id,
    project_id: binding.project_id,
    persona_id: binding.persona_id,
  });
  demand(
    binding.current_context_id === execution.context_id,
    "AUDIENCE_ACTION_STALE",
    "Contexto da ação mudou",
    409,
  );
  const latest = await one(
    db,
    "SELECT id FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
    [execution.content_id],
  );
  demand(
    latest?.id === execution.content_version_id,
    "AUDIENCE_ACTION_CHANGED",
    "Conteúdo mudou; obtenha nova aprovação da origem",
    409,
  );
  if (action.kind !== "publication")
    return queueAudienceOperation(db, actor, execution);
  const job = await schedule(
    db,
    actor,
    {
      social_account_id: execution.social_account_id,
      content_version_id: execution.content_version_id,
      scheduled_at: action.scheduledAt,
    },
    `audience:${execution.id}`,
  );
  await executionReceipt(db, execution, "scheduled");
  return job;
}

export async function observeAudienceExecutions(db: Database) {
  const operations = (
    await db.query(
      "SELECT e.id FROM custom_dim.audience_execution_requests e JOIN custom_dim.operation_jobs o ON o.id=e.operation_job_id WHERE e.last_status NOT IN('succeeded','cancelled') AND e.last_status<>CASE o.status WHEN 'queued' THEN 'scheduled' WHEN 'retry' THEN 'scheduled' WHEN 'completed' THEN 'succeeded' ELSE o.status END ORDER BY e.updated_at LIMIT 100",
    )
  ).rows;
  for (const item of operations)
    await db.transaction(async (tx) => {
      const e = await one(
        tx,
        "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 FOR UPDATE",
        [item.id],
      );
      if (!e || ["succeeded", "cancelled"].includes(e.last_status)) return;
      const job = await one(
        tx,
        "SELECT status,last_error,result FROM custom_dim.operation_jobs WHERE id=$1",
        [e.operation_job_id],
      );
      const status = (
        {
          queued: "scheduled",
          retry: "scheduled",
          completed: "succeeded",
          running: "running",
          executing: "running",
          uncertain: "uncertain",
          failed: "failed",
          blocked: "blocked",
          cancelled: "cancelled",
        } as Record<string, AudienceReceipt["status"]>
      )[job?.status];
      if (status && status !== e.last_status)
        await executionReceipt(tx, e, status, {
          ...(job.result?.externalId
            ? { externalId: job.result.externalId }
            : {}),
          ...(job.last_error && /^[A-Z0-9_]{1,120}$/.test(job.last_error)
            ? { errorCode: job.last_error }
            : {}),
        });
    });
  const rows = (
    await db.query(`SELECT e.id FROM custom_dim.audience_execution_requests e
    JOIN custom_dim.publication_jobs j ON j.content_version_id=e.content_version_id AND j.social_account_id=e.social_account_id
    WHERE e.last_status NOT IN('succeeded','cancelled') AND e.last_status<>CASE j.status WHEN 'queued' THEN 'scheduled' WHEN 'retry' THEN 'scheduled' WHEN 'publishing' THEN 'running' WHEN 'published' THEN 'succeeded' ELSE j.status END
    ORDER BY e.updated_at,e.id LIMIT 100`)
  ).rows;
  const statuses: Record<string, AudienceReceipt["status"]> = {
    queued: "scheduled",
    retry: "scheduled",
    publishing: "running",
    published: "succeeded",
    failed: "failed",
    blocked: "blocked",
    uncertain: "uncertain",
    cancelled: "cancelled",
  };
  for (const row of rows) {
    await db.transaction(async (tx) => {
      // Re-read after acquiring the lock; another observer may already have recorded a terminal state.
      const execution = await one(
        tx,
        "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 FOR UPDATE",
        [row.id],
      );
      if (
        !execution ||
        ["succeeded", "cancelled"].includes(execution.last_status)
      )
        return;
      const job = await one(
        tx,
        `SELECT j.status,j.last_error,p.external_post_id FROM custom_dim.publication_jobs j LEFT JOIN custom_dim.published_posts p ON p.job_id=j.id
        WHERE j.content_version_id=$1 AND j.social_account_id=$2 ORDER BY j.created_at DESC LIMIT 1`,
        [execution.content_version_id, execution.social_account_id],
      );
      if (!job) return;
      const status = statuses[job.status];
      if (!status || status === execution.last_status) return;
      await executionReceipt(tx, execution, status, {
        ...(job.external_post_id ? { externalId: job.external_post_id } : {}),
        ...(job.last_error && /^[A-Z0-9_]{1,120}$/.test(job.last_error)
          ? { errorCode: job.last_error }
          : {}),
      });
    });
  }
}

export async function deliverAudienceReceipt(
  db: Database,
  receiptId: string,
  provider: AudienceActions,
) {
  const row = await one(
    db,
    `SELECT r.receipt,e.organization_id,b.tenant_id,b.project_id,b.persona_id FROM custom_dim.audience_execution_receipts r
    JOIN custom_dim.audience_execution_requests e ON e.id=r.execution_id JOIN custom_dim.audience_bindings b ON b.id=e.binding_id WHERE r.id=$1`,
    [receiptId],
  );
  demand(row, "AUDIENCE_RECEIPT_NOT_FOUND", "Recibo não encontrado", 404);
  await provider.receipt(
    row.organization_id,
    {
      tenant_id: row.tenant_id,
      project_id: row.project_id,
      persona_id: row.persona_id,
    },
    row.receipt,
  );
}

export async function enrichAudienceReceipts(db: Database) {
  const candidates = (
    await db.query(
      "SELECT id FROM custom_dim.audience_execution_requests WHERE last_status='succeeded' AND (last_enriched_at IS NULL OR last_enriched_at<now()-interval '15 minutes') ORDER BY last_enriched_at NULLS FIRST,id LIMIT 100",
    )
  ).rows;
  let enriched = 0;
  for (const candidate of candidates)
    await db.transaction(async (tx) => {
      const execution = await one(
        tx,
        "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 AND last_status='succeeded' FOR UPDATE",
        [candidate.id],
      );
      if (!execution) return;
      const latest = await one(
        tx,
        "SELECT receipt FROM custom_dim.audience_execution_receipts WHERE execution_id=$1 ORDER BY sequence_no DESC LIMIT 1",
        [execution.id],
      );
      if (!latest) return;
      const {
        receiptId: _id,
        actionId: _action,
        actionHash: _hash,
        status: _status,
        occurredAt: _time,
        ...result
      } = latest.receipt;
      const post = await one(
        tx,
        "SELECT p.* FROM custom_dim.published_posts p JOIN custom_dim.publication_jobs j ON j.id=p.job_id WHERE j.organization_id=$1 AND j.content_version_id=$2 AND j.social_account_id=$3 AND p.state='published' ORDER BY p.published_at DESC LIMIT 1",
        [
          execution.organization_id,
          execution.content_version_id,
          execution.social_account_id,
        ],
      );
      if (post?.external_url && /^https:\/\//.test(post.external_url))
        result.evidenceUrls = [post.external_url];
      if (post?.metrics_status === "available") {
        const samples = (
          await tx.query(
            "SELECT metric_code,metric_value,observed_at,provenance FROM custom_dim.publication_metrics WHERE published_post_id=$1 AND observed_at=(SELECT max(observed_at) FROM custom_dim.publication_metrics WHERE published_post_id=$1) ORDER BY metric_code LIMIT 50",
            [post.id],
          )
        ).rows;
        if (
          samples.length &&
          samples.every(
            (s) =>
              Number.isSafeInteger(Number(s.metric_value)) &&
              Number(s.metric_value) >= 0,
          )
        ) {
          result.metrics = Object.fromEntries(
            samples.map((s) => [s.metric_code, Number(s.metric_value)]),
          );
          result.metricsProvenance = [
            ...new Set(samples.map((s) => s.provenance)),
          ]
            .join(",")
            .slice(0, 200);
          result.metricsObservedAt = new Date(
            samples[0].observed_at,
          ).toISOString();
        }
      }
      const costs = (
        await tx.query(
          "SELECT currency,sum(amount)::text AS amount FROM custom_dim.cost_events WHERE organization_id=$1 AND influencer_id=$2 AND cost_type=$3 GROUP BY currency",
          [
            execution.organization_id,
            execution.influencer_id,
            `audience:${execution.id}`,
          ],
        )
      ).rows;
      if (costs.length === 1 && /^\d{1,12}(\.\d{1,6})?$/.test(costs[0].amount))
        result.cost = {
          amount: costs[0].amount,
          currency: costs[0].currency.trim(),
        };
      const receipt = await executionReceipt(
        tx,
        execution,
        "succeeded",
        result,
      );
      await tx.query(
        "UPDATE custom_dim.audience_execution_requests SET last_enriched_at=now() WHERE id=$1",
        [execution.id],
      );
      if (receipt.receiptId !== latest.receipt.receiptId) enriched++;
    });
  return { enriched };
}

export async function flushAudienceReceipts(
  db: Database,
  provider: AudienceActions,
) {
  const pending = (
    await db.query(
      "SELECT id,payload,delivery_attempt_count FROM custom_dim.outbox_events WHERE event_type='audience.receipt' AND processed_at IS NULL AND next_delivery_at<=now() ORDER BY occurred_at,id LIMIT 50",
    )
  ).rows;
  let delivered = 0;
  for (const item of pending) {
    try {
      await deliverAudienceReceipt(db, item.payload.receipt_id, provider);
      await db.query(
        "UPDATE custom_dim.outbox_events SET processed_at=now() WHERE id=$1 AND processed_at IS NULL",
        [item.id],
      );
      delivered++;
    } catch {
      await db.query(
        "UPDATE custom_dim.outbox_events SET delivery_attempt_count=delivery_attempt_count+1,next_delivery_at=now()+($2::text||' seconds')::interval WHERE id=$1 AND processed_at IS NULL",
        [
          item.id,
          Math.min(3600, 30 * 2 ** Math.min(7, item.delivery_attempt_count)),
        ],
      );
    }
  }
  return { delivered, pending: pending.length - delivered };
}

export async function configureAudienceExecutor(
  db: Database,
  actor: Actor,
  influencerId: string,
  enabled: boolean,
  executorUserId?: string,
) {
  authorize(actor, "security.write");
  authorize(actor, "governance.write", { influencerId });
  if (enabled) {
    demand(
      executorUserId,
      "AUDIENCE_EXECUTOR_REQUIRED",
      "Selecione um membro com permissões operacionais limitadas",
      422,
    );
    // A background identity does not inherit a human administrator's MFA assurance.
    const executor = await loadActor(
      db,
      executorUserId,
      actor.organizationId,
      "aal1",
      randomUUID(),
    );
    for (const permission of [
      "identity.read",
      "audience.sync",
      "accounts.read",
      "editorial.read",
      "editorial.write",
      "publication.write",
    ])
      authorize(executor, permission, { influencerId });
    demand(
      !executor.grants.some(
        (g) =>
          g.permission === "approval.write" ||
          g.permission === "*" ||
          g.permission.startsWith("security."),
      ),
      "AUDIENCE_EXECUTOR_PRIVILEGES",
      "Executor automático deve ser separado de aprovação e administração",
      409,
    );
  }
  return scoped(db, actor, async (tx) => {
    await resource(tx, "influencers", influencerId, actor);
    authorize(actor, "security.write");
    authorize(actor, "governance.write", { influencerId });
    const changed = await one(
      tx,
      "UPDATE custom_dim.audience_bindings SET execution_enabled=$1,executor_user_id=$2,last_execution_error=NULL WHERE influencer_id=$3 RETURNING id,execution_enabled,executor_user_id",
      [enabled, enabled ? executorUserId : null, influencerId],
    );
    demand(
      changed,
      "AUDIENCE_BINDING_REQUIRED",
      "Vincule o projeto Audience",
      409,
    );
    await audit(
      tx,
      actor,
      "audience_executor_configured",
      "influencers",
      influencerId,
      changed,
    );
    return changed;
  });
}

export async function pollAudienceActions(
  db: Database,
  provider: AudienceActions,
  contextProvider: AudienceProvider,
) {
  const candidates = (
    await db.query(
      "SELECT id FROM custom_dim.audience_bindings WHERE execution_enabled=true AND executor_user_id IS NOT NULL AND (last_execution_polled_at IS NULL OR last_execution_polled_at<now()-interval '1 minute') ORDER BY last_execution_polled_at NULLS FIRST LIMIT 20",
    )
  ).rows;
  let imported = 0,
    scheduled = 0;
  for (const candidate of candidates) {
    const binding = await one(
      db,
      "UPDATE custom_dim.audience_bindings SET last_execution_polled_at=now() WHERE id=$1 AND execution_enabled=true AND (last_execution_polled_at IS NULL OR last_execution_polled_at<now()-interval '1 minute') RETURNING *",
      [candidate.id],
    );
    if (!binding) continue;
    try {
      const actor = await loadActor(
        db,
        binding.executor_user_id,
        binding.organization_id,
        "aal1",
        randomUUID(),
      );
      demand(
        !actor.grants.some(
          (g) =>
            g.permission === "approval.write" ||
            g.permission === "*" ||
            g.permission.startsWith("security."),
        ),
        "AUDIENCE_EXECUTOR_PRIVILEGES",
        "Permissões do executor mudaram",
        403,
      );
      await syncAudience(
        db,
        actor,
        binding.influencer_id,
        contextProvider,
        actor.userId,
      );
      const mapping = {
        tenant_id: binding.tenant_id,
        project_id: binding.project_id,
        persona_id: binding.persona_id,
      };
      for (const action of await provider.list(
        binding.organization_id,
        mapping,
      )) {
        try {
          const result = await importAudienceAction(
            db,
            actor,
            binding.influencer_id,
            action.actionId,
            provider,
            true,
          );
          if (!result.replay) imported++;
        } catch (error) {
          await db.query(
            "UPDATE custom_dim.audience_bindings SET last_execution_error=$1 WHERE id=$2",
            [
              /^[A-Z0-9_]{1,120}$/.test((error as any)?.code || "")
                ? (error as any).code
                : "AUDIENCE_IMPORT_BLOCKED",
              binding.id,
            ],
          );
        }
      }
      const reviewed = (
        await db.query(
          "SELECT e.id FROM custom_dim.audience_execution_requests e JOIN custom_dim.content_items c ON c.id=e.content_id WHERE e.binding_id=$1 AND e.last_status='awaiting_review' AND c.status='approved' ORDER BY e.created_at LIMIT 100",
          [binding.id],
        )
      ).rows;
      for (const execution of reviewed) {
        try {
          const currentActor = await loadActor(
            db,
            binding.executor_user_id,
            binding.organization_id,
            "aal1",
            randomUUID(),
          );
          await scoped(db, currentActor, (tx) =>
            scheduleAudienceExecution(tx, currentActor, execution.id),
          );
          scheduled++;
        } catch (error) {
          // Missing quorum or a dependency remains reviewable; never manufacture approval or a send.
          await db.query(
            "UPDATE custom_dim.audience_bindings SET last_execution_error=$1 WHERE id=$2",
            [(error as any)?.code || "AUDIENCE_SCHEDULE_BLOCKED", binding.id],
          );
        }
      }
    } catch (error) {
      await db.query(
        "UPDATE custom_dim.audience_bindings SET last_execution_error=$1 WHERE id=$2",
        [
          /^[A-Z0-9_]{1,120}$/.test((error as any)?.code || "")
            ? (error as any).code
            : "AUDIENCE_POLL_UNAVAILABLE",
          binding.id,
        ],
      );
      continue;
    }
  }
  return { imported, scheduled };
}
