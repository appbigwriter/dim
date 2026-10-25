import { pageInput, type Actor } from "../../contracts/src/index";
import { type DB } from "../../db/src/index";
import { resources, readResources } from "./resources";
import { authorize } from "./security";
// Every scoped list filters in SQL BEFORE LIMIT/OFFSET. Indirect resources inherit their parent's scope.
export function scopeExpression(table: string) {
  if (table === "influencers")
    return { influencer: "r.id", account: undefined };
  if (
    [
      "social_accounts",
      "conversations",
      "editorial_topics",
      "content_items",
      "identity_assets",
      "identity_consents",
      "influencer_contracts",
      "identity_disclosures",
      "agent_runs",
      "agent_assignments",
      "onboarding_sessions",
      "revenue_events",
      "cost_events",
      "campaign_deliverables",
      "storage_objects",
    ].includes(table)
  )
    return {
      influencer: "r.influencer_id",
      account:
        table === "social_accounts"
          ? "r.id"
          : table === "conversations"
            ? "r.social_account_id"
            : undefined,
    };
  if (table === "publication_jobs")
    return {
      influencer:
        "(SELECT influencer_id FROM custom_dim.social_accounts WHERE id=r.social_account_id)",
      account: "r.social_account_id",
    };
  if (table === "content_approvals")
    return {
      influencer:
        "(SELECT c.influencer_id FROM custom_dim.content_items c JOIN custom_dim.content_versions v ON v.content_id=c.id WHERE v.id=r.content_version_id)",
      account: undefined,
    };
  if (table === "onboarding_tasks")
    return {
      influencer:
        "(SELECT influencer_id FROM custom_dim.onboarding_sessions WHERE id=r.session_id)",
      account: undefined,
    };
  if (table === "account_provisioning_tasks")
    return {
      influencer:
        "(SELECT influencer_id FROM custom_dim.social_accounts WHERE id=r.social_account_id)",
      account: "r.social_account_id",
    };
  return { influencer: undefined, account: undefined };
}
export async function list(db: DB, actor: Actor, key: string, input: unknown) {
  const def = readResources[key];
  const filters = pageInput.parse(input);
  const values: any[] = [actor.organizationId];
  const clauses = ["r.organization_id=$1"];
  const add = (value: any) => {
    values.push(value);
    return `$${values.length}`;
  };
  const grants = actor.grants.filter(
    (g) => g.permission === `${def.permission}.read` || g.permission === "*",
  );
  const expr = scopeExpression(def.table);
  if (!grants.some((g) => g.scopeType === "organization")) {
    const scopes = grants.flatMap((g) =>
      g.scopeType === "influencer" &&
      ["contacts", "consent_records"].includes(def.table)
        ? [
            `EXISTS(SELECT 1 FROM custom_dim.contact_influencers ci WHERE ci.contact_id=${def.table === "contacts" ? "r.id" : "r.contact_id"} AND ci.influencer_id=${add(g.scopeId)})`,
          ]
        : g.scopeType === "influencer" && expr.influencer
          ? [`${expr.influencer}=${add(g.scopeId)}`]
          : g.scopeType === "account" && expr.account
            ? [`${expr.account}=${add(g.scopeId)}`]
            : [],
    );
    if (!scopes.length) authorize(actor, `${def.permission}.read`);
    clauses.push(`(${scopes.join(" OR ")})`);
  } else authorize(actor, `${def.permission}.read`);
  if (filters.q && resources[key]?.search)
    clauses.push(`r.${resources[key].search} ILIKE ${add(`%${filters.q}%`)}`);
  if (key === "influencers") {
    if (filters.type) clauses.push(`r.type=${add(filters.type)}`);
    if (filters.niche)
      clauses.push(`r.niche ILIKE ${add(`%${filters.niche}%`)}`);
  }
  if (
    filters.status &&
    ![
      "audit",
      "revenues",
      "costs",
      "approvals",
      "assets",
      "disclosures",
      "contracts",
      "identity-consents",
      "consents",
      "policies",
      "role-assignments",
    ].includes(key)
  )
    clauses.push(
      `r.${key === "accounts" ? "account_status" : "status"}=${add(filters.status)}`,
    );
  if (filters.influencer_id && expr.influencer)
    clauses.push(`${expr.influencer}=${add(filters.influencer_id)}`);
  const count = (
    await db.query(
      `SELECT count(*)::int AS total FROM custom_dim.${def.table} r WHERE ${clauses.join(" AND ")}`,
      values,
    )
  ).rows[0].total;
  const limit = add(filters.per_page);
  const offset = add((filters.page - 1) * filters.per_page);
  const rows = (
    await db.query(
      `SELECT r.*${def.table === "conversations" ? ",(SELECT display_name FROM custom_dim.contacts WHERE id=r.contact_id) AS contact_name" : ""} FROM custom_dim.${def.table} r WHERE ${clauses.join(" AND ")} ORDER BY r.created_at DESC,r.id LIMIT ${limit} OFFSET ${offset}`,
      values,
    )
  ).rows;
  return {
    data: rows,
    page: filters.page,
    per_page: filters.per_page,
    total: count,
  };
}
export async function analytics(db: DB, actor: Actor) {
  authorize(actor, "commercial.read");
  const financial = await db.query(
    `SELECT currency,sum(amount)::text AS amount,'revenue' AS kind FROM custom_dim.revenue_events WHERE organization_id=$1 GROUP BY currency UNION ALL SELECT currency,sum(amount)::text,'cost' FROM custom_dim.cost_events WHERE organization_id=$1 GROUP BY currency`,
    [actor.organizationId],
  );
  const metrics = (
    await db.query(
      `SELECT metric_code,sum(metric_value)::text AS value,max(observed_at) AS observed_at,string_agg(DISTINCT provenance,', ') AS source FROM (SELECT DISTINCT ON(published_post_id,metric_code) * FROM custom_dim.publication_metrics WHERE organization_id=$1 ORDER BY published_post_id,metric_code,observed_at DESC,created_at DESC) latest GROUP BY metric_code`,
      [actor.organizationId],
    )
  ).rows;
  return {
    financial: financial.rows,
    metrics: metrics.map((m) => ({
      ...m,
      stale: Date.now() - new Date(m.observed_at).getTime() > 86400000,
    })),
    as_of: new Date().toISOString(),
    source: "custom_dim",
    currency_policy: "No aggregation across currencies",
  };
}
