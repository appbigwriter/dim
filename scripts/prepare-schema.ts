import { readFileSync, writeFileSync } from "node:fs";
const source = readFileSync("prd/DIM-custom_dim-0001.sql", "utf8");
const tables = [
  ...source.matchAll(
    /CREATE TABLE IF NOT EXISTS custom_dim\.(\w+) \(([\s\S]*?)\r?\n\);/g,
  ),
].map((m) => ({ name: m[1], body: m[2] }));
const tenant = new Set(
  tables.filter((t) => /organization_id uuid/.test(t.body)).map((t) => t.name),
);
let sql = `-- Generated from the reviewed baseline: retain 79 domain tables. No public schema changes.\nBEGIN;\nDO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dim_app') THEN CREATE ROLE dim_app NOLOGIN NOBYPASSRLS; END IF; END $$;\nGRANT USAGE ON SCHEMA custom_dim TO dim_app;\nGRANT SELECT ON ALL TABLES IN SCHEMA custom_dim TO dim_app;\n`;
for (const table of tables) {
  if (tenant.has(table.name)) {
    sql += `ALTER TABLE custom_dim.${table.name} ADD CONSTRAINT uq_${table.name}_tenant_id UNIQUE(organization_id,id);\n`;
    sql += `CREATE POLICY dim_tenant ON custom_dim.${table.name} TO dim_app USING (organization_id::text = current_setting('dim.organization_id',true)) WITH CHECK (organization_id::text = current_setting('dim.organization_id',true));\n`;
    sql += `GRANT INSERT, UPDATE ON custom_dim.${table.name} TO dim_app;\n`;
    for (const ref of table.body.matchAll(
      /(\w+) uuid[^\n]*?REFERENCES custom_dim\.(\w+)\(id\)/g,
    )) {
      if (tenant.has(ref[2]))
        sql += `ALTER TABLE custom_dim.${table.name} ADD CONSTRAINT fk_${table.name}_${ref[1]}_tenant FOREIGN KEY(organization_id,${ref[1]}) REFERENCES custom_dim.${ref[2]}(organization_id,id);\n`;
    }
  } else if (
    ["platforms", "connectors", "permissions", "agent_definitions"].includes(
      table.name,
    )
  ) {
    sql += `CREATE POLICY dim_catalog ON custom_dim.${table.name} FOR SELECT TO dim_app USING(true);\n`;
  }
}
sql += `CREATE POLICY dim_organization ON custom_dim.organizations TO dim_app USING(id::text=current_setting('dim.organization_id',true)) WITH CHECK(id::text=current_setting('dim.organization_id',true));
CREATE POLICY dim_profile ON custom_dim.user_profiles TO dim_app USING(user_id::text=current_setting('dim.user_id',true)) WITH CHECK(user_id::text=current_setting('dim.user_id',true));
CREATE POLICY dim_role_permissions ON custom_dim.role_permissions FOR SELECT TO dim_app USING(role_id IN(SELECT id FROM custom_dim.roles));
REVOKE INSERT, UPDATE ON custom_dim.organization_members, custom_dim.roles, custom_dim.role_assignments, custom_dim.organization_settings, custom_dim.approval_policies FROM dim_app;
-- Only admin application commands can mutate access/policies using the control connection.
CREATE FUNCTION custom_dim.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Immutable record: append a new version' USING ERRCODE='42501'; END $$;
`;
for (const name of [
  "audit_logs",
  "content_versions",
  "content_approvals",
  "publication_metrics",
  "influencer_personas",
  "consent_records",
  "identity_consents",
]) {
  sql += `CREATE TRIGGER immutable_${name} BEFORE UPDATE OR DELETE ON custom_dim.${name} FOR EACH ROW EXECUTE FUNCTION custom_dim.reject_mutation();\nREVOKE UPDATE, DELETE, TRUNCATE ON custom_dim.${name} FROM dim_app, service_role;\n`;
}
sql += `ALTER TABLE custom_dim.identity_consents ADD COLUMN supersedes_id uuid REFERENCES custom_dim.identity_consents(id);
ALTER TABLE custom_dim.consent_records ADD COLUMN supersedes_id uuid REFERENCES custom_dim.consent_records(id);
ALTER TABLE custom_dim.identity_consents ADD CONSTRAINT fk_identity_consent_supersedes FOREIGN KEY(organization_id,supersedes_id) REFERENCES custom_dim.identity_consents(organization_id,id);
ALTER TABLE custom_dim.consent_records ADD CONSTRAINT fk_consent_supersedes FOREIGN KEY(organization_id,supersedes_id) REFERENCES custom_dim.consent_records(organization_id,id);
ALTER TABLE custom_dim.publication_jobs ADD COLUMN requested_by uuid REFERENCES auth.users(id);
ALTER TABLE custom_dim.publication_jobs ADD COLUMN lease_until timestamptz;
ALTER TABLE custom_dim.publication_jobs ADD COLUMN request_hash text;
ALTER TABLE custom_dim.operation_jobs ADD COLUMN payload jsonb NOT NULL DEFAULT '{}';
ALTER TABLE custom_dim.operation_jobs ADD COLUMN result jsonb;
ALTER TABLE custom_dim.operation_jobs ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX operation_idempotency ON custom_dim.operation_jobs(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX webhook_dedupe_per_org ON custom_dim.webhook_events(organization_id,provider,dedupe_hash);
CREATE UNIQUE INDEX message_provider_dedupe ON custom_dim.messages(organization_id,conversation_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX outbox_pending ON custom_dim.outbox_events(occurred_at) WHERE processed_at IS NULL;
CREATE INDEX publication_due ON custom_dim.publication_jobs(scheduled_at) WHERE status='queued';
ALTER TABLE custom_dim.organizations ADD COLUMN project_id uuid NOT NULL DEFAULT '3a4d3421-7d76-421c-afe2-e981e12ef64b';
ALTER TABLE custom_dim.organizations ADD COLUMN owner_id uuid REFERENCES auth.users(id);
COMMIT;
`;
writeFileSync(process.argv[2] || "packages/db/hardening.sql", sql);
console.log(
  `Generated tenant constraints and policies for ${tables.length} tables (${tenant.size} tenant tables)`,
);
