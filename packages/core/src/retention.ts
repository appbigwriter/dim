import { randomUUID } from "node:crypto";
import { z } from "zod";
import { demand, text, type Actor } from "../../contracts/src/index";
import { canonicalHash } from "../../contracts/src/audience";
import { one, insert, type DB, type Database } from "../../db/src/index";
import { authorize, audit, resource, member, scoped } from "./security";
import { loadActor } from "./access";
export const retainedEvidence = [
  "audit_logs",
  "consent_records",
  "identity_consents",
  "influencer_contracts",
  "media_licenses",
];
export const retentionPolicy = z
  .object({
    enabled: z.boolean(),
    destinations: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,60}$/),
            kind: z.enum(["storage", "provider", "backup"]),
            minimum_age_days: z.number().int().min(0).max(3650),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
export async function saveRetentionPolicy(
  db: DB,
  actor: Actor,
  input: unknown,
) {
  authorize(actor, "security.write");
  await member(db, actor, actor.userId);
  const settings = retentionPolicy.parse(input);
  demand(
    new Set(settings.destinations.map((d) => d.id)).size ===
      settings.destinations.length,
    "DUPLICATE_DESTINATION",
    "Destinos duplicados",
  );
  await db.query(
    "INSERT INTO custom_dim.organization_settings(organization_id,module_key,settings) VALUES($1,'retention_external',$2) ON CONFLICT(organization_id,module_key) DO UPDATE SET settings=excluded.settings,version=organization_settings.version+1",
    [actor.organizationId, JSON.stringify(settings)],
  );
  await audit(
    db,
    actor,
    "retention_policy",
    "organizations",
    actor.organizationId,
    settings,
  );
  return settings;
}
export async function readRetentionPolicy(db: DB, actor: Actor) {
  authorize(actor, "security.write");
  const row = await one(
    db,
    "SELECT version,settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='retention_external'",
    [actor.organizationId],
  );
  return row || { version: 0, settings: { enabled: false, destinations: [] } };
}
async function eligibleStorage(db: DB, org: string, contact: string) {
  return (
    await db.query(
      `SELECT DISTINCT s.id,s.bucket,s.object_path FROM custom_dim.storage_objects s
 JOIN custom_dim.message_attachments a ON a.storage_object_id=s.id JOIN custom_dim.messages m ON m.id=a.message_id JOIN custom_dim.conversations c ON c.id=m.conversation_id
 WHERE s.organization_id=$1 AND c.contact_id=$2 AND (a.retention_until IS NULL OR a.retention_until<=now())
 AND NOT EXISTS(SELECT 1 FROM custom_dim.identity_consents p WHERE p.evidence_object_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM custom_dim.influencer_contracts p WHERE p.storage_object_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM custom_dim.media_licenses p WHERE p.evidence_object_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM custom_dim.identity_assets p WHERE p.storage_object_id=s.id)
 AND NOT EXISTS(SELECT 1 FROM custom_dim.consent_records p WHERE p.organization_id=$1 AND (position(s.id::text IN coalesce(p.evidence_ref,''))>0 OR position(s.object_path IN coalesce(p.evidence_ref,''))>0))
 AND NOT EXISTS(SELECT 1 FROM custom_dim.operation_jobs j WHERE j.organization_id=$1 AND j.job_type='privacy.external_erasure' AND j.status='completed' AND (j.result->'erased_object_ids') ? s.id::text)
 AND NOT EXISTS(SELECT 1 FROM custom_dim.message_attachments x JOIN custom_dim.messages y ON y.id=x.message_id JOIN custom_dim.conversations z ON z.id=y.conversation_id WHERE x.storage_object_id=s.id AND (z.contact_id<>$2 OR x.retention_until>now())) ORDER BY s.id LIMIT 100`,
      [org, contact],
    )
  ).rows;
}
export type PurgePlan = {
  contractId: "dim.erasure-plan.v1";
  organizationId: string;
  requestId: string;
  contactId: string;
  destination: {
    id: string;
    kind: "storage" | "provider" | "backup";
    minimum_age_days: number;
  };
  policyHash: string;
  reviewHash: string;
  targets: any[];
  retainedEvidence: string[];
};
export type PurgeReceipt = {
  contractId: "dim.erasure-receipt.v1";
  operationId: string;
  planHash: string;
  status: "erased";
  retainedEvidence: string[];
};
export interface ErasureProvider {
  execute(
    plan: PurgePlan,
    expected: PurgeReceipt,
    uncertain: boolean,
  ): Promise<PurgeReceipt>;
}
export async function prepareRetention(
  db: DB,
  actor: Actor,
  requestId: string,
) {
  authorize(actor, "security.write");
  authorize(actor, "inbox.write");
  const parent = await resource(db, "operation_jobs", requestId, actor);
  demand(
    parent.job_type === "privacy.request" &&
      parent.payload.request_type === "erasure" &&
      ["approved_human", "completed_partial"].includes(parent.status),
    "ERASURE_APPROVAL_REQUIRED",
    "Pedido de exclusao aprovado por outro responsavel necessario",
    409,
  );
  const review = parent.result?.review || parent.result;
  demand(
    review?.decision === "approve" &&
      review.reviewed_by !== parent.payload.requested_by,
    "ERASURE_APPROVAL_REQUIRED",
    "Revisao independente ausente",
    409,
  );
  const policy = await readRetentionPolicy(db, actor);
  demand(
    policy.settings.enabled,
    "RETENTION_DISABLED",
    "Configure e habilite destinos de exclusao",
    409,
  );
  const settings = retentionPolicy.parse(policy.settings);
  const contact = await resource(db, "contacts", parent.subject_id, actor);
  const files = await eligibleStorage(db, actor.organizationId, contact.id);
  const threads = (
    await db.query(
      "SELECT c.social_account_id,p.code AS provider,c.external_thread_id FROM custom_dim.conversations c JOIN custom_dim.social_accounts a ON a.id=c.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE c.contact_id=$1 AND c.external_thread_id IS NOT NULL ORDER BY c.id",
      [contact.id],
    )
  ).rows;
  const jobs = [];
  for (const destination of settings.destinations) {
    demand(
      Date.now() - new Date(contact.created_at).getTime() >=
        destination.minimum_age_days * 86400000,
      "RETENTION_HOLD",
      "Contato ainda esta no prazo minimo da politica",
      409,
    );
    const plan: PurgePlan = {
      contractId: "dim.erasure-plan.v1",
      organizationId: actor.organizationId,
      requestId,
      contactId: contact.id,
      destination,
      policyHash: canonicalHash(policy),
      reviewHash: canonicalHash(review),
      targets:
        destination.kind === "storage"
          ? files
          : destination.kind === "provider"
            ? threads
            : [{ subjectId: contact.id }],
      retainedEvidence,
    };
    const planHash = canonicalHash(plan),
      id = randomUUID();
    const expected: PurgeReceipt = {
      contractId: "dim.erasure-receipt.v1",
      operationId: id,
      planHash,
      status: "erased",
      retainedEvidence,
    };
    const old = await one(
      db,
      "SELECT * FROM custom_dim.operation_jobs WHERE organization_id=$1 AND idempotency_key=$2",
      [
        actor.organizationId,
        `erasure:${requestId}:${destination.id}:${planHash}`,
      ],
    );
    if (old) {
      jobs.push(old);
      continue;
    }
    const job = await insert(db, "operation_jobs", {
      id,
      organization_id: actor.organizationId,
      job_type: "privacy.external_erasure",
      subject_id: contact.id,
      status: "pending_human",
      idempotency_key: `erasure:${requestId}:${destination.id}:${planHash}`,
      payload: {
        plan,
        plan_hash: planHash,
        expected_receipt: expected,
        expected_receipt_hash: canonicalHash(expected),
        requested_by: actor.userId,
      },
    });
    await audit(db, actor, "external_erasure_planned", "operation_jobs", id, {
      request_id: requestId,
      plan_hash: planHash,
      destination: destination.id,
      targets: plan.targets.length,
    });
    jobs.push(job);
  }
  return { jobs };
}
export const purgeReviewInput = z
  .object({
    decision: z.enum(["approve", "reject"]),
    plan_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    reason: text,
  })
  .strict();
export async function reviewRetention(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  authorize(actor, "security.write");
  authorize(actor, "inbox.write");
  const data = purgeReviewInput.parse(input),
    job = await resource(db, "operation_jobs", id, actor);
  demand(
    job.job_type === "privacy.external_erasure" &&
      job.status === "pending_human",
    "ERASURE_STATE",
    "Plano nao aguarda revisao",
    409,
  );
  demand(
    job.payload.requested_by !== actor.userId,
    "SELF_APPROVAL",
    "Outro responsavel deve aprovar o plano externo",
    403,
  );
  demand(
    data.plan_hash === job.payload.plan_hash &&
      canonicalHash(job.payload.plan) === data.plan_hash,
    "ERASURE_PLAN_CHANGED",
    "Plano mudou; recarregue",
    409,
  );
  const result = {
    decision: data.decision,
    reviewed_by: actor.userId,
    reviewed_at: new Date().toISOString(),
    plan_hash: data.plan_hash,
    reason: data.reason,
  };
  const updated = await one(
    db,
    "UPDATE custom_dim.operation_jobs SET status=$1,result=$2 WHERE id=$3 AND status='pending_human' RETURNING *",
    [
      data.decision === "approve" ? "approved_human" : "rejected",
      JSON.stringify(result),
      id,
    ],
  );
  demand(updated, "ERASURE_STATE", "Plano ja revisado", 409);
  await audit(db, actor, "external_erasure_review", "operation_jobs", id, {
    decision: data.decision,
    plan_hash: data.plan_hash,
  });
  return updated;
}
export async function executeRetention(
  db: Database,
  actor: Actor,
  id: string,
  input: unknown,
  provider: ErasureProvider,
) {
  const data = z
    .object({
      dry_run: z.boolean().default(true),
      expected_receipt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    })
    .strict()
    .parse(input);
  const fresh = await loadActor(
    db,
    actor.userId,
    actor.organizationId,
    actor.aal,
    actor.correlationId,
  );
  const job = await scoped(db, fresh, async (tx) => {
    authorize(fresh, "security.write");
    authorize(fresh, "inbox.write");
    await tx.query(
      "SELECT id FROM custom_dim.operation_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE",
      [id, fresh.organizationId],
    );
    const row = await resource(tx, "operation_jobs", id, fresh);
    demand(
      row.job_type === "privacy.external_erasure",
      "ERASURE_STATE",
      "Plano de exclusao externo necessario",
      409,
    );
    if (row.status === "completed") return row;
    demand(
      ["approved_human", "uncertain"].includes(row.status),
      "ERASURE_STATE",
      "Revisao independente ou reconciliacao necessaria",
      409,
    );
    demand(
      row.result?.decision === "approve" &&
        row.result.reviewed_by !== row.payload.requested_by &&
        row.result.plan_hash === row.payload.plan_hash,
      "ERASURE_APPROVAL_REQUIRED",
      "Revisao independente invalida",
      409,
    );
    demand(
      canonicalHash(row.payload.plan) === row.payload.plan_hash &&
        canonicalHash(row.payload.expected_receipt) ===
          data.expected_receipt_hash,
      "ERASURE_PLAN_CHANGED",
      "Plano ou recibo esperado diverge",
      409,
    );
    const policy = await readRetentionPolicy(tx, fresh);
    demand(
      policy.settings.enabled &&
        canonicalHash(policy) === row.payload.plan.policyHash,
      "RETENTION_POLICY_CHANGED",
      "Politica mudou; prepare e revise novo plano",
      409,
    );
    const parent = await resource(
      tx,
      "operation_jobs",
      row.payload.plan.requestId,
      fresh,
    );
    const review = parent.result?.review || parent.result;
    demand(
      ["approved_human", "completed_partial"].includes(parent.status) &&
        canonicalHash(review) === row.payload.plan.reviewHash,
      "ERASURE_APPROVAL_CHANGED",
      "Revisao de privacidade mudou",
      409,
    );
    if (row.payload.plan.destination.kind === "storage") {
      const allowed = new Set(
        (await eligibleStorage(tx, fresh.organizationId, row.subject_id)).map(
          (file) => file.id,
        ),
      );
      demand(
        row.payload.plan.targets.every((target: any) => allowed.has(target.id)),
        "EVIDENCE_HOLD",
        "Arquivo passou a ser prova, esta compartilhado ou tem retencao vigente",
        409,
      );
    }
    if (!data.dry_run)
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status='running',attempt_count=attempt_count+1 WHERE id=$1",
        [id],
      );
    return row;
  });
  if (data.dry_run || job.status === "completed")
    return {
      ...job,
      dry_run: data.dry_run,
      expected_receipt_hash: canonicalHash(job.payload.expected_receipt),
    };
  try {
    const receipt = await db.transaction(async (tx) => {
      const current = await loadActor(
        tx,
        actor.userId,
        actor.organizationId,
        actor.aal,
        actor.correlationId,
      );
      authorize(current, "security.write");
      authorize(current, "inbox.write");
      await tx.query(
        "SELECT id FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='retention_external' FOR SHARE",
        [actor.organizationId],
      );
      const policy = await readRetentionPolicy(tx, current);
      demand(
        policy.settings.enabled &&
          canonicalHash(policy) === job.payload.plan.policyHash,
        "RETENTION_POLICY_CHANGED",
        "Politica mudou antes da execucao",
        409,
      );
      if (job.payload.plan.destination.kind === "storage") {
        const ids = job.payload.plan.targets
          .map((target: any) => target.id)
          .sort();
        if (ids.length)
          await tx.query(
            "SELECT id FROM custom_dim.storage_objects WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
            [actor.organizationId, ids],
          );
        const allowed = new Set(
          (await eligibleStorage(tx, actor.organizationId, job.subject_id)).map(
            (file) => file.id,
          ),
        );
        demand(
          ids.every((id: string) => allowed.has(id)),
          "EVIDENCE_HOLD",
          "Arquivo passou a ser prova ou possui retencao vigente",
          409,
        );
      }
      const receipt = await provider.execute(
        job.payload.plan,
        job.payload.expected_receipt,
        job.status === "uncertain",
      );
      demand(
        canonicalHash(receipt) === data.expected_receipt_hash,
        "ERASURE_RECEIPT_MISMATCH",
        "Destino nao confirmou o recibo exato",
        502,
      );
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status='completed',result=$1 WHERE id=$2 AND organization_id=$3 AND status='running'",
        [
          JSON.stringify({
            ...job.result,
            receipt,
            completed_at: new Date().toISOString(),
            erased_object_ids:
              job.payload.plan.destination.kind === "storage"
                ? job.payload.plan.targets.map((target: any) => target.id)
                : [],
          }),
          id,
          actor.organizationId,
        ],
      );
      if (job.payload.plan.destination.kind === "storage")
        for (const target of job.payload.plan.targets)
          await tx.query(
            "UPDATE custom_dim.storage_objects SET scan_status='rejected' WHERE id=$1 AND organization_id=$2",
            [target.id, actor.organizationId],
          );
      await audit(
        tx,
        actor,
        "external_erasure_confirmed",
        "operation_jobs",
        id,
        {
          plan_hash: job.payload.plan_hash,
          receipt_hash: data.expected_receipt_hash,
          destination: job.payload.plan.destination.id,
        },
      );
      return receipt;
    });
    return { status: "completed", receipt };
  } catch (error) {
    await db.query(
      "UPDATE custom_dim.operation_jobs SET status='uncertain',last_error='ERASURE_READBACK_REQUIRED' WHERE id=$1 AND organization_id=$2 AND status='running'",
      [id, actor.organizationId],
    );
    throw error;
  }
}
