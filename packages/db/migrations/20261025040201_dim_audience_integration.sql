BEGIN;
-- Existing personas remain explicitly legacy; API-created identities use audience_builder.
ALTER TABLE custom_dim.influencers ADD COLUMN persona_source text NOT NULL DEFAULT 'legacy_local' CHECK(persona_source IN('legacy_local','audience_builder'));
ALTER TABLE custom_dim.influencer_personas ADD COLUMN source_system text NOT NULL DEFAULT 'dim';
ALTER TABLE custom_dim.influencer_personas ADD COLUMN source_persona_id text;
ALTER TABLE custom_dim.influencer_personas ADD COLUMN source_version_id text;
ALTER TABLE custom_dim.influencer_personas ADD COLUMN source_content_hash text;
ALTER TABLE custom_dim.influencer_personas ADD CONSTRAINT uq_persona_identity_id UNIQUE(organization_id,influencer_id,id);
CREATE UNIQUE INDEX audience_persona_source_unique ON custom_dim.influencer_personas(organization_id,influencer_id,source_system,source_version_id) WHERE source_version_id IS NOT NULL;

CREATE TABLE custom_dim.audience_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),influencer_id uuid NOT NULL,
 tenant_id text NOT NULL,project_id text NOT NULL,persona_id text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','synced','degraded','invalid')),
 current_context_id uuid,last_verified_at timestamptz,last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,influencer_id),UNIQUE(organization_id,influencer_id,id),
 FOREIGN KEY(organization_id,influencer_id) REFERENCES custom_dim.influencers(organization_id,id)
);
CREATE TABLE custom_dim.audience_context_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),influencer_id uuid NOT NULL,binding_id uuid NOT NULL,
 context_version integer NOT NULL CHECK(context_version>0),context_hash text NOT NULL CHECK(context_hash ~ '^sha256:[a-f0-9]{64}$'),
 local_persona_id uuid NOT NULL,persona_version_id text NOT NULL,persona_version integer NOT NULL CHECK(persona_version>0),persona_hash text NOT NULL,
 context jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id),UNIQUE(organization_id,binding_id,id),UNIQUE(binding_id,context_version),
 FOREIGN KEY(organization_id,influencer_id,binding_id) REFERENCES custom_dim.audience_bindings(organization_id,influencer_id,id),
 FOREIGN KEY(organization_id,influencer_id,local_persona_id) REFERENCES custom_dim.influencer_personas(organization_id,influencer_id,id)
);
ALTER TABLE custom_dim.audience_bindings ADD CONSTRAINT fk_audience_current_context FOREIGN KEY(organization_id,id,current_context_id) REFERENCES custom_dim.audience_context_versions(organization_id,binding_id,id);
ALTER TABLE custom_dim.audience_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.audience_context_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY dim_tenant ON custom_dim.audience_bindings TO dim_app USING(organization_id::text=current_setting('dim.organization_id',true)) WITH CHECK(organization_id::text=current_setting('dim.organization_id',true));
CREATE POLICY dim_tenant ON custom_dim.audience_context_versions TO dim_app USING(organization_id::text=current_setting('dim.organization_id',true)) WITH CHECK(organization_id::text=current_setting('dim.organization_id',true));
REVOKE ALL ON custom_dim.audience_bindings,custom_dim.audience_context_versions FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON custom_dim.audience_bindings TO dim_app;
GRANT SELECT,INSERT ON custom_dim.audience_context_versions TO dim_app;
CREATE TRIGGER immutable_audience_context BEFORE UPDATE OR DELETE ON custom_dim.audience_context_versions FOR EACH ROW EXECUTE FUNCTION custom_dim.reject_mutation();
CREATE TRIGGER audience_binding_updated BEFORE UPDATE ON custom_dim.audience_bindings FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
COMMIT;
