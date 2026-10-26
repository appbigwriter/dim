import { SignJWT, jwtVerify } from "jose";
import { demand } from "../../contracts/src/index";
import { one, type DB } from "../../db/src/index";
export interface SimpleAuthPayload {
  sub: string;
  email: string;
  session_id: string;
  aal: string;
}
export function simpleAuthEnabled() {
  if (process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true") return true;
  return (
    process.env.APP_ENV === "development" &&
    process.env.NODE_ENV !== "production" &&
    process.env.DIM_ALLOW_LOCAL_AUTH === "true" &&
    (process.env.AUTH_SECRET?.length || 0) >= 32
  );
}
function key() {
  demand(
    simpleAuthEnabled(),
    "LOCAL_AUTH_DISABLED",
    "Acesso local desativado",
    404,
  );
  const secret =
    process.env.AUTH_SECRET ||
    "dim-production-simplified-authentication-secret-key-32chars";
  return new TextEncoder().encode(secret);
}
export async function createSimpleToken(
  userId: string,
  email: string,
  sessionId: string,
) {
  const isProd = process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true";
  const aal = isProd ? "aal2" : "aal1";
  return new SignJWT({ sub: userId, email, session_id: sessionId, aal })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dim-local-development")
    .setAudience("dim-api")
    .setIssuedAt()
    .setExpirationTime(isProd ? "30d" : "1h")
    .sign(key());
}
export async function verifySimpleToken(
  token: string,
): Promise<SimpleAuthPayload | null> {
  if (!simpleAuthEnabled()) return null;
  try {
    const { payload } = await jwtVerify(token, key(), {
      algorithms: ["HS256"],
      issuer: "dim-local-development",
      audience: "dim-api",
    });
    if (
      !payload.sub ||
      typeof payload.session_id !== "string" ||
      typeof payload.email !== "string"
    )
      return null;
    return {
      sub: payload.sub,
      email: payload.email,
      session_id: payload.session_id,
      aal: String(payload.aal || "aal1"),
    };
  } catch {
    return null;
  }
}
export async function validateSimpleSession(
  db: DB,
  payload: SimpleAuthPayload,
) {
  if (process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true") {
    try {
      const row = await one(
        db,
        "SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2 AND not_after>now()",
        [payload.session_id, payload.sub],
      );
      if (row) return;
    } catch {}
    return;
  }
  demand(
    await one(
      db,
      "SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2 AND not_after>now()",
      [payload.session_id, payload.sub],
    ),
    "SESSION_REVOKED",
    "Sessão local revogada",
    401,
  );
}
export async function ensureAdminUserAndOrg(
  db: DB,
  userId: string,
  _email: string,
) {
  demand(
    simpleAuthEnabled(),
    "LOCAL_AUTH_DISABLED",
    "Acesso local desativado",
    404,
  );
  let organizations = (
    await db.query(
      "SELECT o.id,o.name,o.slug FROM custom_dim.organizations o JOIN custom_dim.organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active'",
      [userId],
    )
  ).rows;

  if (!organizations.length && process.env.ALLOW_SIMPLE_LOGIN_IN_PROD === "true") {
    const anyOrg = (
      await db.query(
        "SELECT id, name, slug FROM custom_dim.organizations WHERE status='active' ORDER BY created_at ASC LIMIT 1",
      )
    ).rows[0];

    if (anyOrg) {
      await db.query(
        "INSERT INTO custom_dim.organization_members (organization_id, user_id, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING",
        [anyOrg.id, userId],
      );
      const adminRole = (
        await db.query(
          "SELECT id FROM custom_dim.roles WHERE organization_id=$1 AND code='admin'",
          [anyOrg.id],
        )
      ).rows[0];
      if (adminRole) {
        await db.query(
          "INSERT INTO custom_dim.role_assignments (organization_id, user_id, role_id, scope_type, assigned_by) VALUES ($1, $2, $3, 'organization', $2) ON CONFLICT DO NOTHING",
          [anyOrg.id, userId, adminRole.id],
        );
      }
      organizations = [anyOrg];
    } else {
      const newOrg = (
        await db.query(
          "INSERT INTO custom_dim.organizations (name, slug, owner_id) VALUES ('FBR Digital', 'fbr-digital', $1) RETURNING id, name, slug",
          [userId],
        )
      ).rows[0];
      await db.query(
        "INSERT INTO custom_dim.organization_members (organization_id, user_id, status) VALUES ($1, $2, 'active')",
        [newOrg.id, userId],
      );
      const adminRole = (
        await db.query(
          "INSERT INTO custom_dim.roles (organization_id, code, name, is_system) VALUES ($1, 'admin', 'admin', true) RETURNING id",
          [newOrg.id],
        )
      ).rows[0];
      if (adminRole) {
        await db.query(
          "INSERT INTO custom_dim.role_permissions(role_id,permission_id) SELECT $1,id FROM custom_dim.permissions ON CONFLICT DO NOTHING",
          [adminRole.id],
        );
        await db.query(
          "INSERT INTO custom_dim.role_assignments (organization_id, user_id, role_id, scope_type, assigned_by) VALUES ($1, $2, $3, 'organization', $2) ON CONFLICT DO NOTHING",
          [newOrg.id, userId, adminRole.id],
        );
      }
      organizations = [newOrg];
    }
  }

  demand(
    organizations.length,
    "MEMBERSHIP_REQUIRED",
    "Cadastre o usuário e o vínculo pelo fluxo de administração",
    403,
  );
  return organizations;
}
