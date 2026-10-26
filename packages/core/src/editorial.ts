import { randomUUID } from "node:crypto";
import {
  demand,
  versionInput,
  approvalInput,
  publicationInput,
  type Actor,
} from "../../contracts/src/index";
import { insert, one, type DB } from "../../db/src/index";
import { audit, authorize, event, hash, resource } from "./security";
import { rightsBlockers } from "./identity";
import { validateAudienceAction } from "../../contracts/src/audience-actions";
import { channelCapabilityCode } from "../../connectors/src/channels";
import { factualFlags } from "./factual";
export async function contentVersion(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  let data = versionInput.strict().parse(input);
  const content = await resource(db, "content_items", id, actor);
  authorize(actor, "editorial.write", { influencerId: content.influencer_id });
  await db.query(
    "SELECT id FROM custom_dim.content_items WHERE id=$1 FOR UPDATE",
    [id],
  );
  const identity = await resource(
    db,
    "influencers",
    content.influencer_id,
    actor,
  );
  if (identity.persona_source === "audience_builder") {
    const binding = await one(
      db,
      "SELECT current_context_id FROM custom_dim.audience_bindings WHERE influencer_id=$1 AND status='synced'",
      [identity.id],
    );
    data = {
      ...data,
      body: {
        ...data.body,
        audience_context_id: binding?.current_context_id || null,
      },
    };
  }
  for (const asset of data.asset_ids) {
    const media = await resource(db, "storage_objects", asset, actor);
    demand(
      media.influencer_id === content.influencer_id,
      "ASSET_IDENTITY_MISMATCH",
      "Mídia pertence a outra identidade",
      409,
    );
  }
  const previous = await one(
    db,
    "SELECT coalesce(max(version_number),0) AS n FROM custom_dim.content_versions WHERE content_id=$1",
    [id],
  );
  const row = await insert(db, "content_versions", {
    organization_id: actor.organizationId,
    content_id: id,
    version_number: Number(previous?.n) + 1,
    body_text: data.body_text,
    body: {
      ...data.body,
      source_urls: data.source_urls,
      asset_ids: data.asset_ids,
    },
    language: data.language,
    format: data.format,
    payload_hash: hash(data),
    created_by: actor.userId,
  });
  for (const url of data.source_urls)
    await insert(db, "content_sources", {
      organization_id: actor.organizationId,
      content_id: id,
      source_url: url,
      captured_at: new Date().toISOString(),
    });
  for (const asset of data.asset_ids)
    await insert(db, "content_assets", {
      organization_id: actor.organizationId,
      content_version_id: row.id,
      storage_object_id: asset,
      role: "attachment",
    });
  await db.query(
    "UPDATE custom_dim.content_items SET status='review_required' WHERE id=$1",
    [id],
  );
  await db.query(
    "UPDATE custom_dim.publication_jobs SET status='cancelled',last_error='CONTENT_CHANGED' WHERE organization_id=$1 AND status IN('queued','retry') AND content_version_id IN(SELECT id FROM custom_dim.content_versions WHERE content_id=$2)",
    [actor.organizationId, id],
  );
  await audit(db, actor, "version", "content_versions", row.id, {
    payload_hash: row.payload_hash,
    version: row.version_number,
  });
  return row;
}
export async function verifyContent(db: DB, actor: Actor, versionId: string) {
  const version = await resource(db, "content_versions", versionId, actor);
  const content = await resource(
    db,
    "content_items",
    version.content_id,
    actor,
  );
  const sourceExecution = await one(
    db,
    "SELECT e.*,b.tenant_id,b.project_id,b.persona_id,b.current_context_id FROM custom_dim.audience_execution_requests e JOIN custom_dim.audience_bindings b ON b.id=e.binding_id WHERE e.content_id=$1",
    [content.id],
  );
  if (sourceExecution) {
    validateAudienceAction(sourceExecution.action, {
      tenant_id: sourceExecution.tenant_id,
      project_id: sourceExecution.project_id,
      persona_id: sourceExecution.persona_id,
    });
    demand(
      sourceExecution.content_version_id === version.id &&
        sourceExecution.context_id === sourceExecution.current_context_id,
      "AUDIENCE_ACTION_CHANGED",
      "Obtenha nova ação aprovada após alteração do conteúdo ou contexto",
      409,
    );
  }
  authorize(actor, "editorial.read", { influencerId: content.influencer_id });
  const identity = await resource(
    db,
    "influencers",
    content.influencer_id,
    actor,
  );
  const flags = await rightsBlockers(db, actor, identity);
  if (sourceExecution?.action.kind !== "crm_update")
    flags.push(...(await factualFlags(db, actor, version, identity)));
  if (identity.persona_source === "audience_builder") {
    const binding = await one(
      db,
      "SELECT current_context_id FROM custom_dim.audience_bindings WHERE influencer_id=$1",
      [identity.id],
    );
    if (
      !binding?.current_context_id ||
      version.body.audience_context_id !== binding.current_context_id
    )
      flags.push("audience_context_changed");
  }
  const assets = (
    await db.query(
      `SELECT a.*,l.valid_until FROM custom_dim.content_assets a LEFT JOIN custom_dim.identity_assets ia ON ia.storage_object_id=a.storage_object_id LEFT JOIN custom_dim.media_licenses l ON l.id=ia.license_id WHERE a.content_version_id=$1`,
      [versionId],
    )
  ).rows;
  if (
    assets.some((a) => !a.valid_until || new Date(a.valid_until) <= new Date())
  )
    flags.push("unlicensed_asset");
  if (
    (!sourceExecution || sourceExecution.action.kind === "publication") &&
    !version.body.source_urls?.length
  )
    flags.push("sources_required");
  if (
    identity.type !== "human" &&
    sourceExecution?.action.kind !== "crm_update"
  ) {
    const disclosures = (
      await db.query(
        "SELECT disclosure_text FROM custom_dim.identity_disclosures WHERE influencer_id=$1 AND enabled=true AND disclosure_type='synthetic'",
        [identity.id],
      )
    ).rows;
    if (
      !disclosures.some((d) => version.body_text?.includes(d.disclosure_text))
    )
      flags.push("disclosure_missing_from_payload");
  }
  return {
    content_version_id: versionId,
    passed: !flags.length,
    flags,
    payload_hash: version.payload_hash,
  };
}
export async function approve(
  db: DB,
  actor: Actor,
  contentId: string,
  input: unknown,
) {
  const data = approvalInput.strict().parse(input);
  const content = await resource(db, "content_items", contentId, actor);
  authorize(actor, "approval.write", { influencerId: content.influencer_id });
  await db.query(
    "SELECT id FROM custom_dim.content_items WHERE id=$1 FOR UPDATE",
    [contentId],
  );
  const version = await resource(
    db,
    "content_versions",
    data.content_version_id,
    actor,
  );
  demand(
    version.content_id === contentId,
    "VERSION_MISMATCH",
    "Versão pertence a outro conteúdo",
  );
  const latest = await one(
    db,
    "SELECT id FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
    [contentId],
  );
  demand(
    latest?.id === version.id,
    "STALE_VERSION",
    "Aprovação exige a versão atual",
    409,
  );
  demand(
    version.created_by !== actor.userId,
    "SELF_APPROVAL",
    "Outro revisor deve aprovar",
    403,
  );
  const policy = await one(
    db,
    "SELECT * FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  demand(policy, "POLICY_REQUIRED", "Defina uma política editorial");
  if (data.decision === "approved") {
    const check = await verifyContent(db, actor, version.id);
    demand(check.passed, "COMPLIANCE_BLOCKED", check.flags.join(", "));
  }
  const row = await insert(db, "content_approvals", {
    ...data,
    organization_id: actor.organizationId,
    approver_id: actor.userId,
    payload_hash: version.payload_hash,
    policy_version: policy.version,
  });
  await db.query("UPDATE custom_dim.content_items SET status=$1 WHERE id=$2", [
    data.decision,
    contentId,
  ]);
  await audit(db, actor, "decision", "content_approvals", row.id, {
    decision: data.decision,
    payload_hash: row.payload_hash,
    policy_version: row.policy_version,
  });
  return row;
}
export async function publicationGuard(db: DB, actor: Actor, job: any) {
  const account = await resource(
    db,
    "social_accounts",
    job.social_account_id,
    actor,
  );
  authorize(actor, "publication.write", {
    influencerId: account.influencer_id,
    accountId: account.id,
  });
  const identity = await resource(
    db,
    "influencers",
    account.influencer_id,
    actor,
  );
  demand(
    identity.status === "active",
    "IDENTITY_INACTIVE",
    "Identidade não está ativa",
  );
  const platform = await one(
    db,
    "SELECT code FROM custom_dim.platforms WHERE id=$1",
    [account.platform_id],
  );
  const rights = await rightsBlockers(db, actor, identity, platform?.code);
  demand(!rights.length, "RIGHTS_REVOKED", rights.join(", "));
  const version = await resource(
    db,
    "content_versions",
    job.content_version_id,
    actor,
  );
  if (identity.persona_source === "audience_builder") {
    const binding = await one(
      db,
      "SELECT current_context_id FROM custom_dim.audience_bindings WHERE influencer_id=$1",
      [identity.id],
    );
    demand(
      binding?.current_context_id &&
        version.body.audience_context_id === binding.current_context_id,
      "AUDIENCE_CONTEXT_CHANGED",
      "Crie e revise uma versão de conteúdo com o contexto atual do Audience",
      409,
    );
  }
  const content = await resource(
    db,
    "content_items",
    version.content_id,
    actor,
  );
  const sourceAction = await one(
    db,
    "SELECT e.*,b.execution_enabled,b.executor_user_id FROM custom_dim.audience_execution_requests e JOIN custom_dim.audience_bindings b ON b.id=e.binding_id WHERE e.content_id=$1",
    [content.id],
  );
  demand(
    !sourceAction || sourceAction.action.kind === "publication",
    "AUDIENCE_ACTION_KIND",
    "Ação de conversa ou CRM deve usar o executor operacional aprovado",
    409,
  );
  if (sourceAction?.automatic) {
    demand(
      sourceAction.execution_enabled &&
        sourceAction.executor_user_id === sourceAction.requested_by &&
        actor.userId === sourceAction.requested_by,
      "AUDIENCE_EXECUTOR_DISABLED",
      "Execução automática desativada ou responsável alterado",
      409,
    );
    demand(
      !actor.grants.some(
        (g) =>
          g.permission === "approval.write" ||
          g.permission === "*" ||
          g.permission.startsWith("security."),
      ),
      "AUDIENCE_EXECUTOR_PRIVILEGES",
      "Executor automático deve permanecer separado de aprovação e administração",
      403,
    );
  }
  demand(
    !sourceAction || sourceAction.social_account_id === account.id,
    "AUDIENCE_ACTION_ACCOUNT",
    "Ação da origem aprovada para outra conta",
    409,
  );
  demand(
    !sourceAction ||
      new Date(job.scheduled_at).getTime() ===
        new Date(sourceAction.action.scheduledAt).getTime(),
    "AUDIENCE_ACTION_SCHEDULE",
    "Horário difere da ação aprovada na origem",
    409,
  );
  if (identity.type !== "human") {
    const disclosure = await one(
      db,
      "SELECT disclosure_text FROM custom_dim.identity_disclosures WHERE organization_id=$1 AND influencer_id=$2 AND platform_id=$3 AND enabled=true AND disclosure_type='synthetic'",
      [actor.organizationId, identity.id, account.platform_id],
    );
    demand(
      disclosure && version.body_text?.includes(disclosure.disclosure_text),
      "CHANNEL_DISCLOSURE_REQUIRED",
      "Inclua disclosure aprovado para este canal",
    );
  }
  demand(
    content.influencer_id === identity.id,
    "IDENTITY_MISMATCH",
    "Conta e conteúdo precisam pertencer à mesma identidade",
  );
  const latest = await one(
    db,
    "SELECT id FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
    [version.content_id],
  );
  demand(latest?.id === version.id, "STALE_VERSION", "Conteúdo foi modificado");
  const approval = await resource(
    db,
    "content_approvals",
    job.approval_id,
    actor,
  );
  const decision = await one(
    db,
    "SELECT id FROM custom_dim.content_approvals WHERE content_version_id=$1 ORDER BY decided_at DESC,created_at DESC LIMIT 1",
    [version.id],
  );
  const policy = await one(
    db,
    "SELECT version FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  demand(
    approval.decision === "approved" &&
      decision?.id === approval.id &&
      approval.content_version_id === version.id &&
      approval.payload_hash === version.payload_hash &&
      approval.policy_version === policy?.version,
    "APPROVAL_INVALID",
    "Aprovação expirada ou invalidada",
  );
  const verification = await verifyContent(db, actor, version.id);
  demand(
    verification.passed,
    "COMPLIANCE_BLOCKED",
    verification.flags.join(", "),
  );
  const policyRule = await one(
    db,
    "SELECT conditions FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  const decisions = (
    await db.query(
      "SELECT DISTINCT ON(approver_id) decision FROM custom_dim.content_approvals WHERE organization_id=$1 AND content_version_id=$2 AND policy_version=$3 AND payload_hash=$4 ORDER BY approver_id,decided_at DESC,created_at DESC",
      [
        actor.organizationId,
        version.id,
        approval.policy_version,
        version.payload_hash,
      ],
    )
  ).rows;
  demand(
    decisions.filter((d) => d.decision === "approved").length >=
      Number(policyRule?.conditions.required_approvals || 1) &&
      decisions.every((d) => d.decision === "approved"),
    "APPROVAL_QUORUM_REQUIRED",
    "A política exige mais aprovações ou possui revisão pendente",
  );
  demand(
    account.account_status === "active" &&
      account.integration_status === "connected",
    "ACCOUNT_DISCONNECTED",
    "Conta não conectada",
  );
  const integration = await one(
    db,
    "SELECT i.*,p.code AS provider FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE i.social_account_id=$1 AND i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now()) AND i.last_tested_at>now()-interval '24 hours'",
    [account.id],
  );
  demand(
    integration,
    "INTEGRATION_EXPIRED",
    "Autorização expirada ou sem teste recente",
  );
  demand(
    await one(
      db,
      "SELECT id FROM custom_dim.account_capabilities WHERE social_account_id=$1 AND capability_code=$2 AND available=true AND checked_at>now()-interval '24 hours'",
      [account.id, channelCapabilityCode(platform?.code)],
    ),
    "CAPABILITY_UNAVAILABLE",
    "Publicação não autorizada",
  );
  return { account, version, integration };
}
export async function schedule(
  db: DB,
  actor: Actor,
  input: unknown,
  key: string,
) {
  const data = publicationInput.strict().parse(input);
  demand(
    key.length >= 8 && key.length <= 180,
    "IDEMPOTENCY_REQUIRED",
    "Use Idempotency-Key com 8–180 caracteres",
    400,
  );
  const requestHash = hash(data);
  const old = await one(
    db,
    "SELECT * FROM custom_dim.publication_jobs WHERE organization_id=$1 AND idempotency_key=$2",
    [actor.organizationId, key],
  );
  if (old) {
    await publicationGuard(db, actor, old);
    demand(
      old.request_hash === requestHash,
      "IDEMPOTENCY_CONFLICT",
      "Chave reutilizada com outro payload",
      409,
    );
    return old;
  }
  const originatingAction = await one(
    db,
    "SELECT id,action FROM custom_dim.audience_execution_requests WHERE content_version_id=$1 AND social_account_id=$2",
    [data.content_version_id, data.social_account_id],
  );
  demand(
    !originatingAction || key === `audience:${originatingAction.id}`,
    "AUDIENCE_ACTION_IDEMPOTENCY",
    "Use o agendamento da ação Audience para impedir publicação duplicada",
    409,
  );
  demand(
    new Date(data.scheduled_at).getTime() >= Date.now() - 60000 ||
      !!(
        originatingAction &&
        new Date(data.scheduled_at).getTime() ===
          new Date(originatingAction.action.scheduledAt).getTime() &&
        new Date(originatingAction.action.approval.expiresAt).getTime() >
          Date.now()
      ),
    "SCHEDULE_IN_PAST",
    "Horário já passou",
  );
  const approval = await one(
    db,
    "SELECT * FROM custom_dim.content_approvals WHERE content_version_id=$1 AND organization_id=$2 ORDER BY decided_at DESC LIMIT 1",
    [data.content_version_id, actor.organizationId],
  );
  demand(approval, "APPROVAL_REQUIRED", "Versão ainda não aprovada");
  const job = { ...data, approval_id: approval.id };
  const { account } = await publicationGuard(db, actor, job);
  const row = await insert(db, "publication_jobs", {
    ...job,
    organization_id: actor.organizationId,
    idempotency_key: key,
    request_hash: requestHash,
    requested_by: actor.userId,
    requested_aal: actor.aal,
  });
  const version = await resource(
    db,
    "content_versions",
    data.content_version_id,
    actor,
  );
  const identity = await resource(
    db,
    "influencers",
    account.influencer_id,
    actor,
  );
  await insert(db, "editorial_calendar_items", {
    publication_job_id: row.id,
    organization_id: actor.organizationId,
    influencer_id: identity.id,
    content_id: version.content_id,
    social_account_id: account.id,
    planned_at: data.scheduled_at,
    timezone: identity.timezone,
  });
  await event(db, actor, "social.publish", row.id, { job_id: row.id });
  await audit(db, actor, "schedule", "publication_jobs", row.id, {
    scheduled_at: row.scheduled_at,
  });
  return row;
}
export async function cancelPublication(db: DB, actor: Actor, id: string) {
  const job = await resource(db, "publication_jobs", id, actor);
  const account = await resource(
    db,
    "social_accounts",
    job.social_account_id,
    actor,
  );
  authorize(actor, "publication.write", {
    influencerId: account.influencer_id,
    accountId: account.id,
  });
  demand(
    ["queued", "retry", "failed"].includes(job.status),
    "CANNOT_CANCEL",
    "Trabalho já enviado ou em reconciliação",
    409,
  );
  await db.query(
    "UPDATE custom_dim.publication_jobs SET status='cancelled' WHERE id=$1",
    [id],
  );
  await audit(db, actor, "cancel", "publication_jobs", id);
  return { status: "cancelled" };
}
export async function operation(
  db: DB,
  actor: Actor,
  kind: string,
  subject: string,
  payload: any,
  key: string,
) {
  payload = {
    ...payload,
    requested_by: actor.userId,
    requested_aal: actor.aal,
  };
  demand(
    key.length >= 8,
    "IDEMPOTENCY_REQUIRED",
    "Informe Idempotency-Key",
    400,
  );
  const previous = await one(
    db,
    "SELECT * FROM custom_dim.operation_jobs WHERE organization_id=$1 AND idempotency_key=$2",
    [actor.organizationId, key],
  );
  if (previous) {
    demand(
      previous.job_type === kind &&
        previous.subject_id === subject &&
        hash(previous.payload) === hash(payload),
      "IDEMPOTENCY_CONFLICT",
      "Payload difere da primeira solicitação",
      409,
    );
    return previous;
  }
  const row = await insert(db, "operation_jobs", {
    id: randomUUID(),
    organization_id: actor.organizationId,
    job_type: kind,
    subject_id: subject,
    status: "queued",
    payload,
    idempotency_key: key,
    correlation_id: actor.correlationId,
  });
  await event(db, actor, kind, row.id, { operation_id: row.id });
  return row;
}
