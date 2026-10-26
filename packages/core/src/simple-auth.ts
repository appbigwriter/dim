import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { one, insert, type DB, type Database } from "../../db/src/index";
import { seedCatalog, seedOrganization } from "../../db/src/seed";
import { rolePermissions } from "./access";

const DEFAULT_SECRET =
  process.env.AUTH_SECRET ||
  "dim-platform-simplified-authentication-secret-key-2026-min-32-chars";

export const authSecret = new TextEncoder().encode(DEFAULT_SECRET);

export interface SimpleAuthPayload {
  sub: string;
  email: string;
  session_id: string;
  aal: string;
}

export async function createSimpleToken(
  userId: string,
  email: string,
): Promise<string> {
  const sessionId = randomUUID();
  return new SignJWT({
    sub: userId,
    email,
    session_id: sessionId,
    aal: "aal2", // Permissão completa sem exigência adicional de MFA
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(authSecret);
}

export async function verifySimpleToken(
  token: string,
): Promise<SimpleAuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, authSecret);
    if (!payload.sub) return null;
    return {
      sub: String(payload.sub),
      email: String(payload.email || ""),
      session_id: String(payload.session_id || randomUUID()),
      aal: String(payload.aal || "aal2"),
    };
  } catch {
    return null;
  }
}

export async function ensureAdminUserAndOrg(
  db: DB | Database,
  userId: string,
  email: string,
  orgName = "FBR Digital",
  orgSlug = "fbr-digital",
) {
  // 1. Tenta registrar o usuário em auth.users para garantir consistência de Foreign Keys
  try {
    await db.query(
      "INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [userId, email],
    );
  } catch {
    // Tabela auth.users pode não existir em mocks locais ou ter restrições
  }

  // 2. Tenta registrar uma sessão ativa em auth.sessions
  try {
    await db.query(
      "INSERT INTO auth.sessions (id, user_id, not_after) VALUES ($1, $2, now() + interval '30 days') ON CONFLICT (id) DO NOTHING",
      [randomUUID(), userId],
    );
  } catch {
    // Pode não existir em testes ou certas instâncias
  }

  // 3. Garante catálogo inicial populado
  try {
    await seedCatalog(db);
  } catch {
    // Catálogo já pode estar presente
  }

  // 4. Verifica organizações das quais o usuário já seja membro ativo
  const userOrgs = (
    await db.query(
      "SELECT o.id, o.name, o.slug FROM custom_dim.organizations o JOIN custom_dim.organization_members m ON m.organization_id = o.id WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active'",
      [userId],
    )
  ).rows;

  if (userOrgs.length > 0) {
    return userOrgs;
  }

  // 5. Se o usuário ainda não for membro de nenhuma organização ativa, vincula-o a uma existente
  const existingOrg = await one(
    db,
    "SELECT id, name, slug FROM custom_dim.organizations WHERE status = 'active' ORDER BY created_at ASC LIMIT 1",
  );

  if (existingOrg) {
    await db.query(
      "INSERT INTO custom_dim.organization_members (organization_id, user_id, status) VALUES ($1, $2, 'active') ON CONFLICT DO NOTHING",
      [existingOrg.id, userId],
    );

    let adminRole = await one(
      db,
      "SELECT id FROM custom_dim.roles WHERE organization_id = $1 AND code = 'admin'",
      [existingOrg.id],
    );

    if (!adminRole) {
      adminRole = await insert(db, "roles", {
        organization_id: existingOrg.id,
        code: "admin",
        name: "admin",
        is_system: true,
      });
      for (const permission of Object.values(rolePermissions).flat()) {
        await db.query(
          "INSERT INTO custom_dim.role_permissions(role_id,permission_id) SELECT $1,id FROM custom_dim.permissions WHERE code=$2 ON CONFLICT DO NOTHING",
          [adminRole.id, permission],
        );
      }
    }

    await db.query(
      "INSERT INTO custom_dim.role_assignments (organization_id, user_id, role_id, scope_type, assigned_by) VALUES ($1, $2, $3, 'organization', $2) ON CONFLICT DO NOTHING",
      [existingOrg.id, userId, adminRole.id],
    );

    return [existingOrg];
  }

  // 6. Caso não exista organização nenhuma, cria a primeira com seedOrganization
  const newOrg = await seedOrganization(db, userId, orgName, orgSlug);
  return [newOrg];
}
