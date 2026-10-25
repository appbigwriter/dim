import { insert, one, type DB } from "./index";
import { rolePermissions } from "../../core/src/access";
export async function seedCatalog(db: DB) {
  for (const [code, name] of [
    ["telegram", "Telegram"],
    ["whatsapp", "WhatsApp Business"],
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["x", "X"],
    ["cms", "Blog / CMS"],
    ["email", "E-mail"],
  ]) {
    await db.query(
      "INSERT INTO custom_dim.platforms(code,name) VALUES($1,$2) ON CONFLICT(code) DO NOTHING",
      [code, name],
    );
    if (code === "telegram")
      await db.query(
        "INSERT INTO custom_dim.connectors(platform_id,code,version,enabled,capabilities) SELECT id,'telegram-bot','1.0.0',true,'{\"publish_text\":true,\"send_messages\":true}' FROM custom_dim.platforms WHERE code=$1 ON CONFLICT DO NOTHING",
        [code],
      );
    if (code === "x")
      await db.query(
        "INSERT INTO custom_dim.connectors(platform_id,code,version,enabled,capabilities) SELECT id,'x-oauth2','1.0.0',true,'{\"publish_text\":true}' FROM custom_dim.platforms WHERE code=$1 ON CONFLICT DO NOTHING",
        [code],
      );
  }
  for (const [code, name] of [
    ["researcher", "Pesquisador"],
    ["writer", "Redator"],
    ["verifier", "Verificador"],
    ["analyst", "Analista"],
  ])
    await db.query(
      "INSERT INTO custom_dim.agent_definitions(code,name) VALUES($1,$2) ON CONFLICT(code) DO NOTHING",
      [code, name],
    );
  await db.query(
    "INSERT INTO custom_dim.connectors(platform_id,code,version,enabled,capabilities) SELECT id,'whatsapp-cloud','1.0.0',true,'{\"send_messages\":true,\"read_messages\":true}' FROM custom_dim.platforms WHERE code='whatsapp' ON CONFLICT DO NOTHING",
  );
  for (const permission of new Set(Object.values(rolePermissions).flat()))
    await db.query(
      "INSERT INTO custom_dim.permissions(code) VALUES($1) ON CONFLICT(code) DO NOTHING",
      [permission],
    );
}
export async function seedOrganization(
  db: DB,
  userId: string,
  name: string,
  slug: string,
) {
  const org = await insert(db, "organizations", {
    name,
    slug,
    owner_id: userId,
  });
  await insert(db, "organization_members", {
    organization_id: org.id,
    user_id: userId,
    status: "active",
    joined_at: new Date().toISOString(),
  });
  for (const [code, permissions] of Object.entries(rolePermissions)) {
    const role = await insert(db, "roles", {
      organization_id: org.id,
      code,
      name: code,
      is_system: true,
    });
    for (const permission of permissions)
      await db.query(
        "INSERT INTO custom_dim.role_permissions(role_id,permission_id) SELECT $1,id FROM custom_dim.permissions WHERE code=$2",
        [role.id, permission],
      );
    if (code === "admin")
      await insert(db, "role_assignments", {
        organization_id: org.id,
        user_id: userId,
        role_id: role.id,
        scope_type: "organization",
        assigned_by: userId,
      });
  }
  return org;
}
export async function assignRole(
  db: DB,
  org: string,
  userId: string,
  code: string,
  scopeType = "organization",
  scopeId: string | null = null,
) {
  const role = await one(
    db,
    "SELECT id FROM custom_dim.roles WHERE organization_id=$1 AND code=$2",
    [org, code],
  );
  return insert(db, "role_assignments", {
    organization_id: org,
    user_id: userId,
    role_id: role.id,
    scope_type: scopeType,
    scope_id: scopeId,
  });
}
