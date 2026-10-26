BEGIN;
ALTER TABLE custom_dim.publication_jobs ADD COLUMN requested_aal text NOT NULL DEFAULT 'aal1' CHECK(requested_aal IN('aal1','aal2'));
ALTER TABLE custom_dim.audience_bindings ADD COLUMN execution_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE custom_dim.audience_bindings ADD COLUMN executor_user_id uuid REFERENCES auth.users(id);
ALTER TABLE custom_dim.audience_bindings ADD COLUMN last_execution_polled_at timestamptz;
ALTER TABLE custom_dim.audience_bindings ADD COLUMN last_execution_error text;
ALTER TABLE custom_dim.outbox_events ADD COLUMN next_delivery_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE custom_dim.outbox_events ADD COLUMN delivery_attempt_count integer NOT NULL DEFAULT 0;
CREATE INDEX audience_receipt_pending_delivery ON custom_dim.outbox_events(next_delivery_at,occurred_at) WHERE event_type='audience.receipt' AND processed_at IS NULL;
CREATE TABLE custom_dim.audience_execution_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
 influencer_id uuid NOT NULL, binding_id uuid NOT NULL, context_id uuid NOT NULL,
 action_id text NOT NULL, action_hash text NOT NULL CHECK(action_hash ~ '^sha256:[a-f0-9]{64}$'), idempotency_key text NOT NULL,
 action jsonb NOT NULL, content_id uuid NOT NULL, content_version_id uuid NOT NULL, social_account_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES auth.users(id), last_status text NOT NULL DEFAULT 'awaiting_review',
 automatic boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(binding_id,action_id), UNIQUE(binding_id,idempotency_key),
 FOREIGN KEY(organization_id,influencer_id,binding_id) REFERENCES custom_dim.audience_bindings(organization_id,influencer_id,id),
 FOREIGN KEY(organization_id,binding_id,context_id) REFERENCES custom_dim.audience_context_versions(organization_id,binding_id,id),
 FOREIGN KEY(organization_id,content_id) REFERENCES custom_dim.content_items(organization_id,id),
 FOREIGN KEY(organization_id,content_version_id) REFERENCES custom_dim.content_versions(organization_id,id),
 FOREIGN KEY(organization_id,social_account_id) REFERENCES custom_dim.social_accounts(organization_id,id)
);
CREATE TABLE custom_dim.audience_execution_receipts (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id), execution_id uuid NOT NULL,
 status text NOT NULL, sequence_no integer NOT NULL CHECK(sequence_no>0), state_hash text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,id), UNIQUE(execution_id,state_hash), UNIQUE(execution_id,sequence_no),
 FOREIGN KEY(organization_id,execution_id) REFERENCES custom_dim.audience_execution_requests(organization_id,id)
);
ALTER TABLE custom_dim.audience_execution_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.audience_execution_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY dim_tenant ON custom_dim.audience_execution_requests TO dim_app USING(organization_id::text=current_setting('dim.organization_id',true)) WITH CHECK(organization_id::text=current_setting('dim.organization_id',true));
CREATE POLICY dim_tenant ON custom_dim.audience_execution_receipts TO dim_app USING(organization_id::text=current_setting('dim.organization_id',true)) WITH CHECK(organization_id::text=current_setting('dim.organization_id',true));
REVOKE ALL ON custom_dim.audience_execution_requests,custom_dim.audience_execution_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON custom_dim.audience_execution_requests,custom_dim.audience_execution_receipts TO dim_app;
GRANT UPDATE(last_status,updated_at) ON custom_dim.audience_execution_requests TO dim_app;
CREATE TRIGGER immutable_audience_receipt BEFORE UPDATE OR DELETE ON custom_dim.audience_execution_receipts FOR EACH ROW EXECUTE FUNCTION custom_dim.reject_mutation();
CREATE TRIGGER audience_execution_updated BEFORE UPDATE ON custom_dim.audience_execution_requests FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE INDEX audience_receipt_execution ON custom_dim.audience_execution_receipts(execution_id,created_at);
INSERT INTO custom_dim.connectors(platform_id,code,version,enabled,capabilities)
SELECT id,code||'-official','1.0.0',true,'{}'::jsonb FROM custom_dim.platforms WHERE code IN('facebook','instagram','youtube','cms','email') ON CONFLICT DO NOTHING;
INSERT INTO custom_dim.permissions(code) VALUES('audience.sync') ON CONFLICT DO NOTHING;
INSERT INTO custom_dim.roles(organization_id,code,name,is_system) SELECT id,'audience_executor','Executor Audience',true FROM custom_dim.organizations ON CONFLICT(organization_id,code) DO NOTHING;
INSERT INTO custom_dim.role_permissions(role_id,permission_id) SELECT r.id,p.id FROM custom_dim.roles r CROSS JOIN custom_dim.permissions p WHERE r.code='audience_executor' AND p.code IN('identity.read','governance.read','audience.sync','accounts.read','editorial.read','editorial.write','publication.read','publication.write') ON CONFLICT DO NOTHING;
COMMIT;
