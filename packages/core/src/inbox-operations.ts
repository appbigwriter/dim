import { z } from "zod";
import { demand, uuid, text, type Actor } from "../../contracts/src/index";
import { one, insert, type DB } from "../../db/src/index";
import { authorize, audit, resource, member, visible } from "./security";

export const inboxFilters = z
  .object({
    influencer_id: uuid.optional(),
    social_account_id: uuid.optional(),
    contact_id: uuid.optional(),
    status: z.enum(["open", "closed"]).optional(),
    channel: z
      .enum([
        "whatsapp",
        "telegram",
        "email",
        "instagram",
        "facebook",
        "x",
        "youtube",
        "blog",
        "crm",
      ])
      .optional(),
    assigned_to: uuid.optional(),
    unassigned: z.enum(["true", "false"]).optional(),
    unread: z.enum(["true", "false"]).optional(),
    sla: z.enum(["overdue", "pending", "none"]).optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    search: z.string().trim().min(1).max(160).optional(),
    since: z.iso.datetime({ offset: true }).optional(),
    until: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
export async function filterInbox(db: DB, actor: Actor, input: unknown) {
  const data = inboxFilters.parse(input);
  const args: unknown[] = [actor.organizationId];
  const clauses = ["c.organization_id=$1"];
  const param = (value: unknown) => {
    args.push(value);
    return `$${args.length}`;
  };
  const grants = actor.grants.filter(
    (g) => g.permission === "*" || g.permission === "inbox.read",
  );
  demand(grants.length, "FORBIDDEN", "Permissão de leitura necessária", 403);
  if (grants.some((g) => g.permission === "*")) authorize(actor, "inbox.read");
  const scopes = grants.map((g) =>
    g.scopeType === "organization"
      ? "true"
      : g.scopeType === "influencer"
        ? `c.influencer_id=${param(g.scopeId)}`
        : g.scopeType === "account"
          ? `c.social_account_id=${param(g.scopeId)}`
          : "false",
  );
  clauses.push(`(${scopes.join(" OR ")})`);
  for (const key of [
    "influencer_id",
    "social_account_id",
    "contact_id",
    "status",
    "assigned_to",
  ] as const)
    if (data[key]) clauses.push(`c.${key}=${param(data[key])}`);
  if (data.channel) clauses.push(`p.code=${param(data.channel)}`);
  if (data.unassigned)
    clauses.push(
      `c.assigned_to IS ${data.unassigned === "true" ? "" : "NOT "}NULL`,
    );
  if (data.unread)
    clauses.push(`c.unread_count${data.unread === "true" ? ">0" : "=0"}`);
  if (data.sla)
    clauses.push(
      data.sla === "none"
        ? "c.sla_due_at IS NULL"
        : `c.status='open' AND c.sla_due_at${data.sla === "overdue" ? "<" : " >="}now()`,
    );
  if (data.tag)
    clauses.push(`c.tags @> ${param(JSON.stringify([data.tag]))}::jsonb`);
  if (data.search)
    clauses.push(
      `(co.display_name ILIKE ${param(`%${data.search.replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\')`,
    );
  if (data.since) clauses.push(`c.opened_at>=${param(data.since)}`);
  if (data.until) clauses.push(`c.opened_at<=${param(data.until)}`);
  demand(
    !data.since ||
      !data.until ||
      new Date(data.since).getTime() <= new Date(data.until).getTime(),
    "INVALID_DATE_RANGE",
    "Período inválido",
  );
  const rows = (
    await db.query(
      `SELECT c.*,p.code AS channel,co.display_name AS contact_name,count(*) OVER() AS total_count FROM custom_dim.conversations c JOIN custom_dim.social_accounts a ON a.id=c.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id JOIN custom_dim.contacts co ON co.id=c.contact_id WHERE ${clauses.join(" AND ")} ORDER BY c.sla_due_at ASC NULLS LAST,c.opened_at DESC,c.id LIMIT ${param(data.limit)} OFFSET ${param(data.offset)}`,
      args,
    )
  ).rows;
  const total = rows.length
    ? Number(rows[0].total_count)
    : data.offset > 0
      ? Number(
          (
            await one(
              db,
              `SELECT count(*) AS count FROM custom_dim.conversations c JOIN custom_dim.social_accounts a ON a.id=c.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id JOIN custom_dim.contacts co ON co.id=c.contact_id WHERE ${clauses.join(" AND ")}`,
              args.slice(0, -2),
            )
          ).count,
        )
      : 0;
  return {
    data: rows.map(({ total_count: _total, ...r }: any) => r),
    total,
    limit: data.limit,
    offset: data.offset,
  };
}

export const escalationPolicy = z
  .object({
    enabled: z.boolean(),
    after_minutes: z.number().int().min(0).max(43200),
    assigned_to: uuid,
  })
  .strict();
export async function saveEscalationPolicy(
  db: DB,
  actor: Actor,
  input: unknown,
) {
  authorize(actor, "security.write");
  await member(db, actor, actor.userId);
  const settings = escalationPolicy.parse(input);
  await member(db, actor, settings.assigned_to);
  await db.query(
    "INSERT INTO custom_dim.organization_settings(organization_id,module_key,settings) VALUES($1,'inbox_escalation',$2) ON CONFLICT(organization_id,module_key) DO UPDATE SET settings=excluded.settings,version=organization_settings.version+1",
    [actor.organizationId, JSON.stringify(settings)],
  );
  await audit(
    db,
    actor,
    "escalation_policy",
    "organizations",
    actor.organizationId,
    settings,
  );
  return settings;
}
export async function escalateInbox(db: DB, actor: Actor) {
  authorize(actor, "inbox.write");
  const row = await one(
    db,
    "SELECT settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='inbox_escalation'",
    [actor.organizationId],
  );
  if (!row?.settings.enabled) return { escalated: 0 };
  const policy = escalationPolicy.parse(row.settings);
  await member(db, actor, policy.assigned_to);
  const conversations = (
    await db.query(
      "SELECT * FROM custom_dim.conversations WHERE organization_id=$1 AND status='open' AND sla_due_at+($2::text||' minutes')::interval<now() ORDER BY sla_due_at LIMIT 100 FOR UPDATE SKIP LOCKED",
      [actor.organizationId, policy.after_minutes],
    )
  ).rows;
  let escalated = 0;
  for (const c of conversations) {
    if (!visible(actor, "inbox.write", c)) continue;
    const key = `sla:${c.id}:${new Date(c.sla_due_at).toISOString()}`;
    const claim = await one(
      db,
      "INSERT INTO custom_dim.operation_jobs(organization_id,job_type,subject_id,status,idempotency_key,payload) VALUES($1,'inbox.escalation',$2,'completed',$3,$4) ON CONFLICT DO NOTHING RETURNING id",
      [
        actor.organizationId,
        c.id,
        key,
        JSON.stringify({
          assigned_to: policy.assigned_to,
          sla_due_at: c.sla_due_at,
        }),
      ],
    );
    if (!claim) continue;
    await db.query(
      "UPDATE custom_dim.conversations SET assigned_to=$1 WHERE id=$2",
      [policy.assigned_to, c.id],
    );
    await insert(db, "conversation_assignments", {
      organization_id: actor.organizationId,
      conversation_id: c.id,
      user_id: policy.assigned_to,
    });
    await audit(db, actor, "sla_escalated", "conversations", c.id, {
      assigned_to: policy.assigned_to,
    });
    escalated++;
  }
  return { escalated };
}
export const privacyReviewInput = z
  .object({
    decision: z.enum(["approve", "reject"]),
    reason: text,
    lawful_basis: text,
    retain_evidence: z.literal(true),
  })
  .strict();
export async function reviewPrivacy(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  authorize(actor, "security.write");
  authorize(actor, "inbox.write");
  const data = privacyReviewInput.parse(input);
  const job = await resource(db, "operation_jobs", id, actor);
  demand(
    job.job_type === "privacy.request" && job.status === "pending_human",
    "PRIVACY_STATE",
    "Pedido não aguarda revisão",
    409,
  );
  demand(
    job.payload.requested_by !== actor.userId,
    "SELF_APPROVAL",
    "Outro responsável deve revisar o pedido",
    403,
  );
  const updated = await one(
    db,
    "UPDATE custom_dim.operation_jobs SET status=$1,result=$2 WHERE id=$3 AND status='pending_human' RETURNING *",
    [
      data.decision === "approve" ? "approved_human" : "rejected",
      JSON.stringify({
        ...data,
        reviewed_by: actor.userId,
        reviewed_at: new Date().toISOString(),
      }),
      id,
    ],
  );
  demand(
    updated,
    "PRIVACY_STATE",
    "Pedido alterado por outro responsável",
    409,
  );
  await audit(db, actor, "privacy_review", "operation_jobs", id, {
    decision: data.decision,
    lawful_basis: data.lawful_basis,
  });
  return updated;
}
export async function executePrivacy(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  authorize(actor, "security.write");
  authorize(actor, "inbox.write");
  const data = z
    .object({ dry_run: z.boolean().default(true), reason: text })
    .strict()
    .parse(input);
  await db.query(
    "SELECT id FROM custom_dim.operation_jobs WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [id, actor.organizationId],
  );
  const job = await resource(db, "operation_jobs", id, actor);
  demand(
    job.job_type === "privacy.request" &&
      ["approved_human", "completed_partial"].includes(job.status),
    "PRIVACY_STATE",
    "Revisão humana aprovada necessária",
    409,
  );
  if (job.status === "completed_partial") return job.result;
  demand(
    ["erasure", "restriction"].includes(job.payload.request_type),
    "PRIVACY_TYPE",
    "Use a exportação para acesso; correção requer revisão dos campos específicos",
  );
  await db.query(
    "SELECT id FROM custom_dim.contacts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [job.subject_id, actor.organizationId],
  );
  const contact = await resource(db, "contacts", job.subject_id, actor);
  const messages = await one(
    db,
    "SELECT count(*) AS count FROM custom_dim.messages m JOIN custom_dim.conversations c ON c.id=m.conversation_id WHERE c.contact_id=$1 AND m.body_reference IS NOT NULL",
    [contact.id],
  );
  const plan = {
    request_id: id,
    contact_id: contact.id,
    type: job.payload.request_type,
    messages: Number(messages.count),
    retained: [
      "consent_records",
      "audit_logs",
      "contact_identity_hashes",
      "storage_evidence",
    ],
    external_erasure_required: true,
    dry_run: data.dry_run,
  };
  if (data.dry_run) return plan;
  demand(
    !(await one(
      db,
      "SELECT j.id FROM custom_dim.operation_jobs j JOIN custom_dim.conversations c ON c.id=j.subject_id WHERE c.contact_id=$1 AND j.job_type='inbox.send' AND j.status IN('running','uncertain') LIMIT 1",
      [contact.id],
    )),
    "PRIVACY_DELIVERY_PENDING",
    "Reconcilie envios em andamento/incertos antes de aplicar a restrição",
    409,
  );
  await db.query(
    "UPDATE custom_dim.contacts SET status=$1,display_name=CASE WHEN $1='erased' THEN NULL ELSE display_name END,locale=CASE WHEN $1='erased' THEN NULL ELSE locale END WHERE id=$2",
    [
      job.payload.request_type === "erasure" ? "erased" : "restricted",
      contact.id,
    ],
  );
  await db.query(
    "UPDATE custom_dim.operation_jobs SET status='cancelled',payload='{}',last_error='PRIVACY_RESTRICTION' WHERE job_type='inbox.send' AND status IN('queued','retry') AND subject_id IN(SELECT id FROM custom_dim.conversations WHERE contact_id=$1)",
    [contact.id],
  );
  await db.query(
    "UPDATE custom_dim.conversations SET status='closed',unread_count=0 WHERE contact_id=$1",
    [contact.id],
  );
  if (job.payload.request_type === "erasure") {
    await db.query(
      "UPDATE custom_dim.operation_jobs SET payload='{}' WHERE job_type='inbox.send' AND subject_id IN(SELECT id FROM custom_dim.conversations WHERE contact_id=$1)",
      [contact.id],
    );
    await db.query(
      "UPDATE custom_dim.operation_jobs j SET payload=jsonb_build_object('suppressed',true),status=CASE WHEN status IN('queued','retry') THEN 'cancelled' ELSE status END WHERE job_type='inbox.ingest' AND EXISTS(SELECT 1 FROM custom_dim.conversations c WHERE c.contact_id=$1 AND c.social_account_id=j.subject_id AND c.external_thread_id=j.payload->'incoming'->>'thread')",
      [contact.id],
    );
    await db.query(
      "UPDATE custom_dim.conversations SET external_thread_id=NULL WHERE contact_id=$1",
      [contact.id],
    );
    await db.query(
      "UPDATE custom_dim.messages SET body_reference=NULL WHERE conversation_id IN(SELECT id FROM custom_dim.conversations WHERE contact_id=$1)",
      [contact.id],
    );
    await db.query(
      "UPDATE custom_dim.conversation_notes SET note_body='[REMOVIDO POR PEDIDO DO TITULAR]' WHERE conversation_id IN(SELECT id FROM custom_dim.conversations WHERE contact_id=$1)",
      [contact.id],
    );
    await db.query(
      "UPDATE custom_dim.contact_identities SET encrypted_reference=NULL,verification_status='erased' WHERE contact_id=$1",
      [contact.id],
    );
  }
  const result = {
    ...plan,
    dry_run: false,
    executed_at: new Date().toISOString(),
    executed_by: actor.userId,
  };
  await db.query(
    "UPDATE custom_dim.operation_jobs SET status='completed_partial',result=$1 WHERE id=$2",
    [JSON.stringify({ ...result, review: job.result }), id],
  );
  await audit(db, actor, "privacy_executed_partial", "contacts", contact.id, {
    request_id: id,
    type: job.payload.request_type,
    reason: data.reason,
    messages: plan.messages,
  });
  return result;
}
export async function retentionPreview(db: DB, actor: Actor) {
  authorize(actor, "security.write");
  authorize(actor, "inbox.read");
  const policy = await one(
    db,
    "SELECT settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='inbox'",
    [actor.organizationId],
  );
  const days = Number(policy?.settings.retention_days || 365);
  const rows = (
    await db.query(
      "SELECT c.id,c.contact_id,count(m.id) AS messages,min(m.occurred_at) AS oldest_message FROM custom_dim.conversations c JOIN custom_dim.messages m ON m.conversation_id=c.id WHERE c.organization_id=$1 AND c.status='closed' AND m.occurred_at<now()-($2::text||' days')::interval AND m.body_reference IS NOT NULL GROUP BY c.id,c.contact_id ORDER BY oldest_message LIMIT 100",
      [actor.organizationId, days],
    )
  ).rows;
  return {
    dry_run: true,
    retention_days: days,
    candidates: rows,
    execution_requires:
      "reviewed erasure request per contact; no deletion of consent, audit, or evidence",
  };
}
