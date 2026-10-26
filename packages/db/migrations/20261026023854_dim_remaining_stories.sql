BEGIN;
ALTER TABLE custom_dim.audience_execution_requests ALTER COLUMN social_account_id DROP NOT NULL;
ALTER TABLE custom_dim.audience_execution_requests ADD COLUMN operation_job_id uuid;
ALTER TABLE custom_dim.audience_execution_requests ADD COLUMN last_enriched_at timestamptz;
ALTER TABLE custom_dim.audience_execution_requests ADD CONSTRAINT audience_operation_tenant FOREIGN KEY(organization_id,operation_job_id) REFERENCES custom_dim.operation_jobs(organization_id,id);
GRANT UPDATE(operation_job_id) ON custom_dim.audience_execution_requests TO dim_app;
CREATE TABLE custom_dim.content_verifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),influencer_id uuid NOT NULL,
 content_version_id uuid NOT NULL,payload_hash text NOT NULL,policy_version integer NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES auth.users(id),passed boolean NOT NULL,evidence jsonb NOT NULL,findings jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(organization_id,id),
 FOREIGN KEY(organization_id,influencer_id) REFERENCES custom_dim.influencers(organization_id,id),
 FOREIGN KEY(organization_id,content_version_id) REFERENCES custom_dim.content_versions(organization_id,id)
);
ALTER TABLE custom_dim.content_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY dim_tenant ON custom_dim.content_verifications TO dim_app USING(organization_id::text=current_setting('dim.organization_id',true)) WITH CHECK(organization_id::text=current_setting('dim.organization_id',true));
REVOKE ALL ON custom_dim.content_verifications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON custom_dim.content_verifications TO dim_app;
CREATE TRIGGER immutable_content_verification BEFORE UPDATE OR DELETE ON custom_dim.content_verifications FOR EACH ROW EXECUTE FUNCTION custom_dim.reject_mutation();
CREATE INDEX content_verification_latest ON custom_dim.content_verifications(content_version_id,created_at DESC);
INSERT INTO custom_dim.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM custom_dim.roles r CROSS JOIN custom_dim.permissions p WHERE r.code='audience_executor' AND p.code IN('inbox.read','inbox.write') ON CONFLICT DO NOTHING;
COMMIT;
