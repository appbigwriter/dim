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
  return new TextEncoder().encode(process.env.AUTH_SECRET!);
}
export async function createSimpleToken(
  userId: string,
  email: string,
  sessionId: string,
) {
  return new SignJWT({ sub: userId, email, session_id: sessionId, aal: "aal1" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("dim-local-development")
    .setAudience("dim-api")
    .setIssuedAt()
    .setExpirationTime("1h")
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
      payload.aal !== "aal1" ||
      typeof payload.email !== "string"
    )
      return null;
    return {
      sub: payload.sub,
      email: payload.email,
      session_id: payload.session_id,
      aal: "aal1",
    };
  } catch {
    return null;
  }
}
export async function validateSimpleSession(
  db: DB,
  payload: SimpleAuthPayload,
) {
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
  // Local authentication only opens a pre-provisioned membership. It grants no roles.
  demand(
    simpleAuthEnabled(),
    "LOCAL_AUTH_DISABLED",
    "Acesso local desativado",
    404,
  );
  const organizations = (
    await db.query(
      "SELECT o.id,o.name,o.slug FROM custom_dim.organizations o JOIN custom_dim.organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active'",
      [userId],
    )
  ).rows;
  demand(
    organizations.length,
    "MEMBERSHIP_REQUIRED",
    "Cadastre o usuário e o vínculo pelo fluxo de administração",
    403,
  );
  return organizations;
}
