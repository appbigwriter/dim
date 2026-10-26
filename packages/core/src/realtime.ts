import { createHash, randomUUID } from "node:crypto";
import type { Actor } from "../../contracts/src/index";
import { demand } from "../../contracts/src/index";
import { type DB, type Database } from "../../db/src/index";
import { authorize, scoped } from "./security";
import { loadActor } from "./access";
import { escalateInbox } from "./inbox-operations";
export function inboxScope(actor: Actor, permission: string, alias = "c") {
  const grants = actor.grants.filter(
    (g) => g.permission === permission || g.permission === "*",
  );
  demand(grants.length, "FORBIDDEN", "Permissao de inbox necessaria", 403);
  if (grants.some((g) => g.permission === "*")) authorize(actor, permission);
  const values: unknown[] = [actor.organizationId];
  const conditions = grants.map((g) => {
    if (g.scopeType === "organization") return "true";
    values.push(g.scopeId);
    return g.scopeType === "influencer"
      ? `${alias}.influencer_id=$${values.length}`
      : g.scopeType === "account"
        ? `${alias}.social_account_id=$${values.length}`
        : "false";
  });
  return {
    sql: `${alias}.organization_id=$1 AND (${conditions.join(" OR ")})`,
    values,
  };
}
export async function inboxRevision(db: DB, actor: Actor) {
  const scope = inboxScope(actor, "inbox.read");
  const rows = (
    await db.query(
      `SELECT c.id,c.updated_at,
   (SELECT max(m.updated_at) FROM custom_dim.messages m WHERE m.conversation_id=c.id) AS message_revision,
   (SELECT count(*) FROM custom_dim.messages m WHERE m.conversation_id=c.id) AS message_count,
   (SELECT max(n.updated_at) FROM custom_dim.conversation_notes n WHERE n.conversation_id=c.id) AS note_revision,
   (SELECT co.updated_at FROM custom_dim.contacts co WHERE co.id=c.contact_id) AS contact_revision
   FROM custom_dim.conversations c WHERE ${scope.sql} ORDER BY c.id`,
      scope.values,
    )
  ).rows;
  return createHash("sha256")
    .update(
      JSON.stringify({
        rows,
        scope: actor.grants.filter(
          (g) => g.permission === "*" || g.permission === "inbox.read",
        ),
      }),
    )
    .digest("hex");
}
export async function boundedInboxActor(
  db: DB,
  userId: string,
  organizationId: string,
) {
  const actor = await loadActor(
    db,
    userId,
    organizationId,
    "aal1",
    randomUUID(),
  );
  const allowed = new Set([
    "identity.read",
    "accounts.read",
    "inbox.read",
    "inbox.write",
  ]);
  demand(
    actor.grants.some((g) => g.permission === "inbox.write") &&
      actor.grants.every((g) => allowed.has(g.permission)),
    "INBOX_EXECUTOR_BOUNDS",
    "Executor automatico exige usuario real com papel restrito de atendimento",
    403,
  );
  return actor;
}
export async function runScheduledInboxEscalations(db: Database) {
  const policies = (
    await db.query(
      "SELECT organization_id,settings FROM custom_dim.organization_settings WHERE module_key='inbox_escalation' AND settings->>'enabled'='true' AND settings->>'execution_user_id' IS NOT NULL ORDER BY organization_id",
    )
  ).rows;
  let escalated = 0,
    blocked = 0;
  for (const policy of policies) {
    try {
      const actor = await boundedInboxActor(
        db,
        policy.settings.execution_user_id,
        policy.organization_id,
      );
      const result = await scoped(db, actor, (tx) => escalateInbox(tx, actor));
      escalated += result.escalated;
    } catch {
      blocked++;
    }
  }
  return { escalated, blocked };
}
