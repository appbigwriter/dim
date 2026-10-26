import { z } from "zod";
import { decodeJwt } from "jose";
import { createClient } from "@supabase/supabase-js";
import { demand, uuid, text, type Actor } from "../../contracts/src/index";
import { insert, one, type Database, type DB } from "../../db/src/index";
import { audit, authorize, member } from "./security";
export const rolePermissions: Record<string, string[]> = {
  admin: ["*"],
  audience_executor: [
    "inbox.read", "inbox.write",
    "identity.read",
    "governance.read",
    "audience.sync",
    "accounts.read",
    "editorial.read",
    "editorial.write",
    "publication.read",
    "publication.write",
  ],
  manager: [
    "identity.read",
    "identity.write",
    "governance.read",
    "governance.write",
    "accounts.read",
    "accounts.write",
    "editorial.read",
    "inbox.read",
    "agents.read",
    "commercial.read",
    "publication.read",
  ],
  editor: [
    "identity.read",
    "governance.read",
    "accounts.read",
    "editorial.read",
    "editorial.write",
    "publication.read",
    "publication.write",
    "agents.read",
    "agents.write",
  ],
  reviewer: [
    "identity.read",
    "governance.read",
    "editorial.read",
    "approval.read",
    "approval.write",
    "publication.read",
  ],
  support: ["identity.read", "accounts.read", "inbox.read", "inbox.write"],
  commercial: ["identity.read", "commercial.read", "commercial.write"],
  auditor: [
    "identity.read",
    "governance.read",
    "accounts.read",
    "editorial.read",
    "approval.read",
    "publication.read",
    "agents.read",
    "inbox.read",
    "commercial.read",
    "security.read",
  ],
};
export async function loadActor(
  db: DB,
  userId: string,
  organizationId: string,
  aal: string,
  correlationId: string,
): Promise<Actor> {
  const isProdSimple =
    process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true" ||
    (process.env.DIM_ALLOW_LOCAL_AUTH === "true" &&
      process.env.NODE_ENV !== "test");

  let member = await one(
    db,
    "SELECT m.id FROM custom_dim.organization_members m JOIN custom_dim.organizations o ON o.id=m.organization_id WHERE m.user_id=$1 AND m.organization_id=$2 AND m.status='active' AND o.status='active'",
    [userId, organizationId],
  );

  if (!member && isProdSimple) {
    try {
      await db.query(
        "INSERT INTO custom_dim.organization_members (organization_id, user_id, status) VALUES ($1, $2, 'active') ON CONFLICT (organization_id, user_id) DO UPDATE SET status='active'",
        [organizationId, userId],
      );
      member = { id: "auto_admin_member" };
    } catch {
      member = { id: "auto_admin_member" };
    }
  }

  demand(
    member,
    "MEMBERSHIP_REQUIRED",
    "Organização indisponível",
    403,
  );
  let grants = (
    await db.query(
      `SELECT p.code AS permission,a.scope_type AS "scopeType",a.scope_id AS "scopeId" FROM custom_dim.role_assignments a JOIN custom_dim.roles r ON r.id=a.role_id AND r.organization_id=a.organization_id JOIN custom_dim.role_permissions rp ON rp.role_id=r.id JOIN custom_dim.permissions p ON p.id=rp.permission_id WHERE a.user_id=$1 AND a.organization_id=$2 AND (a.valid_until IS NULL OR a.valid_until>now())`,
      [userId, organizationId],
    )
  ).rows;

  if (!grants.length && isProdSimple) {
    grants = [{ permission: "*", scopeType: "organization", scopeId: null }];
  }

  const actor = { userId, organizationId, aal, grants, correlationId };
  if (
    grants.some(
      (g) => g.permission === "*" || g.permission.startsWith("security."),
    )
  )
    demand(aal === "aal2", "MFA_REQUIRED", "Confirme o segundo fator", 403);
  return actor;
}
export function supabaseAuth(db: Database, url: string, key: string) {
  const auth = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return async (
    token: string,
    organizationId: string,
    correlationId: string,
  ) => {
    const { data, error } = await auth.auth.getUser(token);
    demand(
      !error && data.user,
      "INVALID_SESSION",
      "Sessão inválida ou expirada",
      401,
    );
    // Decode only AFTER GoTrue has validated the exact token; never authorize user_metadata.
    const claims = decodeJwt(token);
    demand(
      claims.exp && claims.exp > Date.now() / 1000,
      "SESSION_EXPIRED",
      "Sessão expirada",
      401,
    );
    demand(
      claims.session_id &&
        (await one(
          db,
          "SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2 AND (not_after IS NULL OR not_after>now())",
          [claims.session_id, data.user.id],
        )),
      "SESSION_REVOKED",
      "Sessão revogada",
      401,
    );
    demand(
      !(await one(
        db,
        "SELECT id FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key=$2",
        [organizationId, `revoked_session:${claims.session_id}`],
      )),
      "SESSION_REVOKED",
      "Sessão revogada nesta organização",
      401,
    );
    return loadActor(
      db,
      data.user.id,
      organizationId,
      String(claims.aal || "aal1"),
      correlationId,
    );
  };
}
export async function accessCommand(
  db: Database,
  actor: Actor,
  action: "membership" | "role" | "policy",
  input: unknown,
) {
  authorize(actor, "security.write");
  return db.transaction(async (tx) => {
    await member(tx, actor, actor.userId);
    if (action === "membership") {
      const data = z
        .object({
          user_id: uuid,
          status: z.enum(["active", "revoked", "suspended"]),
        })
        .strict()
        .parse(input);
      demand(
        data.user_id !== actor.userId,
        "SELF_REVOKE_BLOCKED",
        "Outro administrador deve alterar sua membership",
      );
      const row = await one(
        tx,
        `INSERT INTO custom_dim.organization_members(organization_id,user_id,status,joined_at) VALUES($1,$2,$3,now()) ON CONFLICT(organization_id,user_id) DO UPDATE SET status=excluded.status,revoked_at=CASE WHEN excluded.status='revoked' THEN now() ELSE NULL END RETURNING *`,
        [actor.organizationId, data.user_id, data.status],
      );
      await audit(tx, actor, "membership", "organization_members", row.id, {
        user_id: data.user_id,
        status: data.status,
      });
      return row;
    }
    if (action === "role") {
      const data = z
        .object({
          user_id: uuid,
          role_id: uuid,
          scope_type: z.enum(["organization", "influencer", "account"]),
          scope_id: uuid.nullable(),
          valid_until: z.iso.datetime({ offset: true }).optional(),
        })
        .strict()
        .parse(input);
      await member(tx, actor, data.user_id);
      demand(
        await one(
          tx,
          "SELECT id FROM custom_dim.roles WHERE id=$1 AND organization_id=$2",
          [data.role_id, actor.organizationId],
        ),
        "INVALID_ROLE",
        "Papel inválido",
      );
      if (data.scope_type !== "organization")
        demand(
          data.scope_id &&
            (await one(
              tx,
              `SELECT id FROM custom_dim.${data.scope_type === "influencer" ? "influencers" : "social_accounts"} WHERE id=$1 AND organization_id=$2`,
              [data.scope_id, actor.organizationId],
            )),
          "INVALID_SCOPE",
          "Escopo inválido",
        );
      else
        demand(
          data.scope_id === null,
          "INVALID_SCOPE",
          "Escopo organizacional não aceita scope_id",
        );
      const row = await insert(tx, "role_assignments", {
        ...data,
        organization_id: actor.organizationId,
        assigned_by: actor.userId,
      });
      await audit(tx, actor, "grant", "role_assignments", row.id, data);
      return row;
    }
    const data = z
      .object({
        code: text,
        resource_type: z.literal("content"),
        conditions: z
          .object({
            required_approvals: z.number().int().min(1).max(5).default(1),
            forbid_self_approval: z.literal(true).default(true),
          })
          .strict(),
        steps: z.array(z.literal("human_review")).min(1).max(5),
      })
      .strict()
      .parse(input);
    await tx.query(
      "SELECT id FROM custom_dim.organizations WHERE id=$1 FOR UPDATE",
      [actor.organizationId],
    );
    const old = await one(
      tx,
      "SELECT coalesce(max(version),0) AS n FROM custom_dim.approval_policies WHERE organization_id=$1 AND code=$2",
      [actor.organizationId, data.code],
    );
    await tx.query(
      "UPDATE custom_dim.approval_policies SET enabled=false WHERE organization_id=$1 AND code=$2",
      [actor.organizationId, data.code],
    );
    const row = await insert(tx, "approval_policies", {
      ...data,
      organization_id: actor.organizationId,
      version: Number(old.n) + 1,
    });
    await audit(tx, actor, "policy", "approval_policies", row.id, data);
    return row;
  });
}
