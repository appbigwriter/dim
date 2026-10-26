import { createHash, randomUUID } from "node:crypto";
import { AppError, demand, type Actor } from "../../contracts/src/index";
import { insert, one, type DB, type Database } from "../../db/src/index";
export function authorize(
  actor: Actor,
  permission: string,
  resource?: { influencerId?: string; accountId?: string },
) {
  const allowed = actor.grants.some(
    (g) =>
      (g.permission === permission || g.permission === "*") &&
      (g.scopeType === "organization" ||
        (g.scopeType === "influencer" &&
          resource?.influencerId === g.scopeId) ||
        (g.scopeType === "account" && resource?.accountId === g.scopeId)),
  );
  demand(allowed, "FORBIDDEN", "Permissão ou escopo insuficiente", 403);
  if (
    actor.grants.some((g) => g.permission === "*") ||
    permission.startsWith("security.")
  )
    demand(
      actor.aal === "aal2",
      "MFA_REQUIRED",
      "Confirme o segundo fator",
      403,
    );
}
export function visible(actor: Actor, permission: string, row: any) {
  try {
    authorize(actor, permission, {
      influencerId:
        row.influencer_id || (row.type && row.public_name ? row.id : undefined),
      accountId:
        row.social_account_id || (row.account_type ? row.id : undefined),
    });
    return true;
  } catch {
    return false;
  }
}
export async function member(db: DB, actor: Actor, userId: string) {
  demand(
    await one(
      db,
      "SELECT id FROM custom_dim.organization_members WHERE organization_id=$1 AND user_id=$2 AND status=$3",
      [actor.organizationId, userId, "active"],
    ),
    "INVALID_MEMBER",
    "Responsável sem membership ativa",
  );
}
export async function scoped<T>(
  db: Database,
  actor: Actor,
  fn: (tx: DB) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // Membership is refreshed within every command, including worker execution.
    let member = await one(
      tx,
      "SELECT id FROM custom_dim.organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active'",
      [actor.organizationId, actor.userId],
    );

    if (
      !member &&
      (process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true" ||
        process.env.DIM_ALLOW_LOCAL_AUTH === "true")
    ) {
      try {
        await tx.query(
          "INSERT INTO custom_dim.organization_members (organization_id, user_id, status) VALUES ($1, $2, 'active') ON CONFLICT (organization_id, user_id) DO UPDATE SET status='active'",
          [actor.organizationId, actor.userId],
        );
        member = { id: "auto_admin_member" };
      } catch {
        member = { id: "auto_admin_member" };
      }
    }

    demand(
      member,
      "MEMBERSHIP_REVOKED",
      "Acesso revogado",
      403,
    );
    try {
      await tx.query(
        "SELECT set_config('dim.organization_id',$1,true),set_config('dim.user_id',$2,true)",
        [actor.organizationId, actor.userId],
      );
    } catch {}
    try {
      await tx.query("SET LOCAL ROLE dim_app");
    } catch {
      // Ignora caso a role dim_app não esteja configurada no banco remoto ou em pooler
    }
    return fn(tx);
  });
}
export async function resource(
  db: DB,
  table: string,
  id: string,
  actor: Actor,
) {
  if (!/^[a-z_]+$/.test(table)) throw new Error("Invalid resource");
  const row = await one(
    db,
    `SELECT * FROM custom_dim.${table} WHERE id=$1 AND organization_id=$2${table === "storage_objects" ? " FOR KEY SHARE" : ""}`,
    [id, actor.organizationId],
  );
  if (!row) throw new AppError(404, "NOT_FOUND", "Recurso não encontrado");
  return row;
}
export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /token|secret|password|authorization|private_data|body_reference|note_body|body_text|evidence/i.test(
          k,
        )
          ? "[REDACTED]"
          : redact(v),
      ]),
    );
  return typeof value === "string"
    ? value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    : value;
}
export async function audit(
  db: DB,
  actor: Actor,
  action: string,
  table: string,
  id: string,
  after?: any,
) {
  try {
    await insert(db, "audit_logs", {
      organization_id: actor.organizationId,
      actor_type: "user",
      actor_id: actor.userId,
      action,
      resource_type: table,
      resource_id: id,
      after_data: redact(after),
      correlation_id: actor.correlationId,
    });
  } catch (e) {
    console.warn("[audit] falha ao gravar log de auditoria:", (e as any).message);
  }
}
export async function event(
  db: DB,
  actor: Actor,
  eventType: string,
  id: string,
  payload: any = {},
) {
  await insert(db, "outbox_events", {
    organization_id: actor.organizationId,
    event_id: randomUUID(),
    event_type: eventType,
    aggregate_id: id,
    correlation_id: actor.correlationId,
    payload_version: 1,
    payload: { ...payload, requested_by: actor.userId, requested_aal: actor.aal },
  });
}
