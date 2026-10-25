-- DIM Platform — Migration 0001 | schema custom_dim | PostgreSQL/Supabase Self-Hosted
-- Migration single-use: aplicar via runner que controla historico. REVISAR em STAGING. Requer auth.users existente.
-- A migration não cria buckets nem expõe custom_dim no PostgREST.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS custom_dim;
REVOKE ALL ON SCHEMA custom_dim FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA custom_dim TO service_role;
CREATE OR REPLACE FUNCTION custom_dim.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE IF NOT EXISTS custom_dim.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  legal_name text,
  country_code char(2),
  default_locale text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_dim.user_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  locale text NOT NULL DEFAULT 'pt-BR',
  timezone text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_dim.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','revoked')),
  invited_at timestamptz,
  joined_at timestamptz,
  revoked_at timestamptz,
  UNIQUE(organization_id,user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organization_members_organization ON custom_dim.organization_members(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.organization_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  module_key text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id,module_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_organization_settings_organization ON custom_dim.organization_settings(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  UNIQUE(organization_id,code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_roles_organization ON custom_dim.roles(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  risk_level text NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_dim.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES custom_dim.roles(id),
  permission_id uuid NOT NULL REFERENCES custom_dim.permissions(id),
  UNIQUE(role_id,permission_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON custom_dim.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON custom_dim.role_permissions(permission_id);

CREATE TABLE IF NOT EXISTS custom_dim.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role_id uuid NOT NULL REFERENCES custom_dim.roles(id),
  scope_type text NOT NULL DEFAULT 'organization' CHECK (scope_type IN ('organization','influencer','account')),
  scope_id uuid,
  valid_until timestamptz,
  assigned_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_organization ON custom_dim.role_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role_id ON custom_dim.role_assignments(role_id);

CREATE TABLE IF NOT EXISTS custom_dim.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teams_organization ON custom_dim.teams(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  team_id uuid NOT NULL REFERENCES custom_dim.teams(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  UNIQUE(team_id,user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_team_members_organization ON custom_dim.team_members(organization_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON custom_dim.team_members(team_id);

CREATE TABLE IF NOT EXISTS custom_dim.approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  code text NOT NULL,
  resource_type text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  version int NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(organization_id,code,version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_approval_policies_organization ON custom_dim.approval_policies(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.storage_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  bucket text NOT NULL,
  object_path text NOT NULL,
  mime_type text,
  byte_size bigint CHECK (byte_size >= 0),
  sha256 text,
  visibility text NOT NULL DEFAULT 'private',
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(bucket,object_path),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_storage_objects_organization ON custom_dim.storage_objects(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.legal_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  party_type text NOT NULL CHECK (party_type IN ('person','company')),
  display_name text NOT NULL,
  country_code char(2),
  private_data_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_legal_parties_organization ON custom_dim.legal_parties(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.media_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  license_type text NOT NULL,
  holder_party_id uuid REFERENCES custom_dim.legal_parties(id),
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_object_id uuid REFERENCES custom_dim.storage_objects(id),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_licenses_organization ON custom_dim.media_licenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_media_licenses_holder_party_id ON custom_dim.media_licenses(holder_party_id);
CREATE INDEX IF NOT EXISTS idx_media_licenses_evidence_object_id ON custom_dim.media_licenses(evidence_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  code text NOT NULL,
  type text NOT NULL CHECK(type IN ('human','virtual','hybrid')),
  public_name text NOT NULL,
  internal_name text NOT NULL,
  slug text NOT NULL,
  primary_language text NOT NULL DEFAULT 'pt-BR',
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  niche text,
  owner_user_id uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','under_review','changes_required','approved','provisioning','ready','active','paused','restricted','offboarding','archived')),
  row_version integer NOT NULL DEFAULT 1,
  UNIQUE(organization_id,slug),
  UNIQUE(organization_id,code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencers_organization ON custom_dim.influencers(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL UNIQUE REFERENCES custom_dim.influencers(id),
  biography_short text,
  biography_long text,
  value_proposition text,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  positioning jsonb NOT NULL DEFAULT '{}'::jsonb,
  appearance_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_profiles_organization ON custom_dim.influencer_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_profiles_influencer_id ON custom_dim.influencer_profiles(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_personas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  version int NOT NULL CHECK(version > 0),
  public_bio text,
  tone jsonb NOT NULL DEFAULT '{}'::jsonb,
  traits jsonb NOT NULL DEFAULT '{}'::jsonb,
  knowledge jsonb NOT NULL DEFAULT '{}'::jsonb,
  boundaries jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'draft',
  approved_at timestamptz,
  UNIQUE(influencer_id,version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_personas_organization ON custom_dim.influencer_personas(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_personas_influencer_id ON custom_dim.influencer_personas(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.persona_canon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  persona_id uuid NOT NULL REFERENCES custom_dim.influencer_personas(id),
  fact_key text NOT NULL,
  fact_value jsonb NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  UNIQUE(persona_id,fact_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_persona_canon_organization ON custom_dim.persona_canon(organization_id);
CREATE INDEX IF NOT EXISTS idx_persona_canon_persona_id ON custom_dim.persona_canon(persona_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_languages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  language_code text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE(influencer_id,language_code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_languages_organization ON custom_dim.influencer_languages(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_languages_influencer_id ON custom_dim.influencer_languages(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  responsibility text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_assignments_organization ON custom_dim.influencer_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_assignments_influencer_id ON custom_dim.influencer_assignments(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  old_status text,
  new_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_status_history_organization ON custom_dim.influencer_status_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_status_history_influencer_id ON custom_dim.influencer_status_history(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  metric_code text NOT NULL,
  target_value numeric NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  CHECK(period_end>=period_start),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_goals_organization ON custom_dim.influencer_goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_goals_influencer_id ON custom_dim.influencer_goals(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.influencer_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  owner_party_id uuid REFERENCES custom_dim.legal_parties(id),
  contract_type text NOT NULL,
  version int NOT NULL DEFAULT 1,
  starts_at timestamptz,
  ends_at timestamptz,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_object_id uuid REFERENCES custom_dim.storage_objects(id),
  status text NOT NULL DEFAULT 'draft',
  UNIQUE(influencer_id,contract_type,version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_influencer_contracts_organization ON custom_dim.influencer_contracts(organization_id);
CREATE INDEX IF NOT EXISTS idx_influencer_contracts_influencer_id ON custom_dim.influencer_contracts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_influencer_contracts_owner_party_id ON custom_dim.influencer_contracts(owner_party_id);
CREATE INDEX IF NOT EXISTS idx_influencer_contracts_storage_object_id ON custom_dim.influencer_contracts(storage_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.identity_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  subject_party_id uuid NOT NULL REFERENCES custom_dim.legal_parties(id),
  use_type text NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_object_id uuid REFERENCES custom_dim.storage_objects(id),
  granted_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_consents_organization ON custom_dim.identity_consents(organization_id);
CREATE INDEX IF NOT EXISTS idx_identity_consents_influencer_id ON custom_dim.identity_consents(influencer_id);
CREATE INDEX IF NOT EXISTS idx_identity_consents_subject_party_id ON custom_dim.identity_consents(subject_party_id);
CREATE INDEX IF NOT EXISTS idx_identity_consents_evidence_object_id ON custom_dim.identity_consents(evidence_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.identity_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  storage_object_id uuid NOT NULL REFERENCES custom_dim.storage_objects(id),
  license_id uuid REFERENCES custom_dim.media_licenses(id),
  asset_type text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_assets_organization ON custom_dim.identity_assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_identity_assets_influencer_id ON custom_dim.identity_assets(influencer_id);
CREATE INDEX IF NOT EXISTS idx_identity_assets_storage_object_id ON custom_dim.identity_assets(storage_object_id);
CREATE INDEX IF NOT EXISTS idx_identity_assets_license_id ON custom_dim.identity_assets(license_id);

CREATE TABLE IF NOT EXISTS custom_dim.identity_disclosures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  platform_id uuid,
  disclosure_type text NOT NULL,
  disclosure_text text NOT NULL,
  policy_version int NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identity_disclosures_organization ON custom_dim.identity_disclosures(organization_id);
CREATE INDEX IF NOT EXISTS idx_identity_disclosures_influencer_id ON custom_dim.identity_disclosures(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_dim.connectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id uuid NOT NULL REFERENCES custom_dim.platforms(id),
  code text NOT NULL,
  version text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  UNIQUE(platform_id,code,version),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connectors_platform_id ON custom_dim.connectors(platform_id);

CREATE TABLE IF NOT EXISTS custom_dim.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  platform_id uuid NOT NULL REFERENCES custom_dim.platforms(id),
  account_type text NOT NULL,
  external_id text,
  handle text,
  public_url text,
  owner_reference text,
  recovery_owner_id uuid REFERENCES auth.users(id),
  account_status text NOT NULL DEFAULT 'planned',
  integration_status text NOT NULL DEFAULT 'disconnected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_accounts_organization ON custom_dim.social_accounts(organization_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_influencer_id ON custom_dim.social_accounts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform_id ON custom_dim.social_accounts(platform_id);

CREATE TABLE IF NOT EXISTS custom_dim.account_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  connector_id uuid NOT NULL REFERENCES custom_dim.connectors(id),
  auth_type text NOT NULL,
  secret_ref text NOT NULL,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  last_tested_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_integrations_organization ON custom_dim.account_integrations(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_integrations_social_account_id ON custom_dim.account_integrations(social_account_id);
CREATE INDEX IF NOT EXISTS idx_account_integrations_connector_id ON custom_dim.account_integrations(connector_id);

CREATE TABLE IF NOT EXISTS custom_dim.account_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  capability_code text NOT NULL,
  available boolean NOT NULL DEFAULT false,
  checked_at timestamptz,
  restriction_reason text,
  UNIQUE(social_account_id,capability_code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_capabilities_organization ON custom_dim.account_capabilities(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_capabilities_social_account_id ON custom_dim.account_capabilities(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.account_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  principal_type text NOT NULL,
  principal_id uuid NOT NULL,
  permission_code text NOT NULL,
  granted_by uuid REFERENCES auth.users(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_permissions_organization ON custom_dim.account_permissions(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_permissions_social_account_id ON custom_dim.account_permissions(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.account_provisioning_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  task_key text NOT NULL,
  assignee_id uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  evidence_object_id uuid REFERENCES custom_dim.storage_objects(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_provisioning_tasks_organization ON custom_dim.account_provisioning_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_provisioning_tasks_social_account_id ON custom_dim.account_provisioning_tasks(social_account_id);
CREATE INDEX IF NOT EXISTS idx_account_provisioning_tasks_evidence_object_id ON custom_dim.account_provisioning_tasks(evidence_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.account_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  capability text,
  status text NOT NULL,
  response_code text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_health_checks_organization ON custom_dim.account_health_checks(organization_id);
CREATE INDEX IF NOT EXISTS idx_account_health_checks_social_account_id ON custom_dim.account_health_checks(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.onboarding_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  current_step text NOT NULL DEFAULT 'identity',
  status text NOT NULL DEFAULT 'in_progress',
  initiated_by uuid REFERENCES auth.users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_organization ON custom_dim.onboarding_sessions(organization_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_influencer_id ON custom_dim.onboarding_sessions(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.onboarding_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  session_id uuid NOT NULL REFERENCES custom_dim.onboarding_sessions(id),
  step_code text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  completed_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  UNIQUE(session_id,step_code),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_organization ON custom_dim.onboarding_steps(organization_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_steps_session_id ON custom_dim.onboarding_steps(session_id);

CREATE TABLE IF NOT EXISTS custom_dim.onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  session_id uuid NOT NULL REFERENCES custom_dim.onboarding_sessions(id),
  task_code text NOT NULL,
  assignee_id uuid REFERENCES auth.users(id),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  evidence_object_id uuid REFERENCES custom_dim.storage_objects(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_organization ON custom_dim.onboarding_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_session_id ON custom_dim.onboarding_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_evidence_object_id ON custom_dim.onboarding_tasks(evidence_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.onboarding_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  session_id uuid NOT NULL REFERENCES custom_dim.onboarding_sessions(id),
  approval_type text NOT NULL,
  reviewer_id uuid REFERENCES auth.users(id),
  decision text,
  comments text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_approvals_organization ON custom_dim.onboarding_approvals(organization_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_approvals_session_id ON custom_dim.onboarding_approvals(session_id);

CREATE TABLE IF NOT EXISTS custom_dim.onboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  session_id uuid NOT NULL REFERENCES custom_dim.onboarding_sessions(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_organization ON custom_dim.onboarding_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_events_session_id ON custom_dim.onboarding_events(session_id);

CREATE TABLE IF NOT EXISTS custom_dim.ai_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  provider text NOT NULL,
  model_id text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_model_configs_organization ON custom_dim.ai_model_configs(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.agent_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  purpose text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS custom_dim.agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  agent_id uuid NOT NULL REFERENCES custom_dim.agent_definitions(id),
  model_config_id uuid REFERENCES custom_dim.ai_model_configs(id),
  approval_policy_id uuid REFERENCES custom_dim.approval_policies(id),
  enabled boolean NOT NULL DEFAULT false,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(influencer_id,agent_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_organization ON custom_dim.agent_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_influencer_id ON custom_dim.agent_assignments(influencer_id);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_id ON custom_dim.agent_assignments(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_model_config_id ON custom_dim.agent_assignments(model_config_id);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_approval_policy_id ON custom_dim.agent_assignments(approval_policy_id);

CREATE TABLE IF NOT EXISTS custom_dim.knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  source_type text NOT NULL,
  uri text,
  status text NOT NULL DEFAULT 'pending',
  last_indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_organization ON custom_dim.knowledge_sources(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sources_influencer_id ON custom_dim.knowledge_sources(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  agent_assignment_id uuid NOT NULL REFERENCES custom_dim.agent_assignments(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  task_type text NOT NULL,
  input_reference text,
  output_reference text,
  tokens_used jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost numeric(18,6) NOT NULL DEFAULT 0 CHECK(cost>=0),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_organization ON custom_dim.agent_runs(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_assignment_id ON custom_dim.agent_runs(agent_assignment_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_influencer_id ON custom_dim.agent_runs(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.editorial_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid REFERENCES custom_dim.influencers(id),
  title text NOT NULL,
  research_status text NOT NULL DEFAULT 'idea',
  source_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_editorial_topics_organization ON custom_dim.editorial_topics(organization_id);
CREATE INDEX IF NOT EXISTS idx_editorial_topics_influencer_id ON custom_dim.editorial_topics(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  topic_id uuid REFERENCES custom_dim.editorial_topics(id),
  title text NOT NULL,
  content_type text NOT NULL,
  objective text,
  status text NOT NULL DEFAULT 'idea',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_items_organization ON custom_dim.content_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_items_influencer_id ON custom_dim.content_items(influencer_id);
CREATE INDEX IF NOT EXISTS idx_content_items_topic_id ON custom_dim.content_items(topic_id);

CREATE TABLE IF NOT EXISTS custom_dim.content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  content_id uuid NOT NULL REFERENCES custom_dim.content_items(id),
  version_number int NOT NULL CHECK(version_number>0),
  language text NOT NULL,
  format text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_text text,
  payload_hash text NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  UNIQUE(content_id,version_number,language,format),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_versions_organization ON custom_dim.content_versions(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_versions_content_id ON custom_dim.content_versions(content_id);

CREATE TABLE IF NOT EXISTS custom_dim.content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  content_id uuid NOT NULL REFERENCES custom_dim.content_items(id),
  source_url text,
  publisher text,
  captured_at timestamptz,
  claim_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_sources_organization ON custom_dim.content_sources(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_content_id ON custom_dim.content_sources(content_id);

CREATE TABLE IF NOT EXISTS custom_dim.content_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  content_version_id uuid NOT NULL REFERENCES custom_dim.content_versions(id),
  storage_object_id uuid NOT NULL REFERENCES custom_dim.storage_objects(id),
  role text NOT NULL,
  license_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_assets_organization ON custom_dim.content_assets(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_content_version_id ON custom_dim.content_assets(content_version_id);
CREATE INDEX IF NOT EXISTS idx_content_assets_storage_object_id ON custom_dim.content_assets(storage_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.content_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  content_version_id uuid NOT NULL REFERENCES custom_dim.content_versions(id),
  approver_id uuid NOT NULL REFERENCES auth.users(id),
  decision text NOT NULL CHECK(decision IN ('approved','rejected','changes_requested')),
  payload_hash text NOT NULL,
  policy_version int NOT NULL,
  rationale text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_approvals_organization ON custom_dim.content_approvals(organization_id);
CREATE INDEX IF NOT EXISTS idx_content_approvals_content_version_id ON custom_dim.content_approvals(content_version_id);

CREATE TABLE IF NOT EXISTS custom_dim.editorial_calendar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  content_id uuid NOT NULL REFERENCES custom_dim.content_items(id),
  social_account_id uuid REFERENCES custom_dim.social_accounts(id),
  planned_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_items_organization ON custom_dim.editorial_calendar_items(organization_id);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_items_influencer_id ON custom_dim.editorial_calendar_items(influencer_id);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_items_content_id ON custom_dim.editorial_calendar_items(content_id);
CREATE INDEX IF NOT EXISTS idx_editorial_calendar_items_social_account_id ON custom_dim.editorial_calendar_items(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.publication_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  content_version_id uuid NOT NULL REFERENCES custom_dim.content_versions(id),
  approval_id uuid NOT NULL REFERENCES custom_dim.content_approvals(id),
  scheduled_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  idempotency_key text NOT NULL,
  attempt_count int NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  last_error text,
  UNIQUE(organization_id,idempotency_key),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_organization ON custom_dim.publication_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_social_account_id ON custom_dim.publication_jobs(social_account_id);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_content_version_id ON custom_dim.publication_jobs(content_version_id);
CREATE INDEX IF NOT EXISTS idx_publication_jobs_approval_id ON custom_dim.publication_jobs(approval_id);

CREATE TABLE IF NOT EXISTS custom_dim.publication_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  job_id uuid NOT NULL REFERENCES custom_dim.publication_jobs(id),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL,
  provider_response_ref text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publication_attempts_organization ON custom_dim.publication_attempts(organization_id);
CREATE INDEX IF NOT EXISTS idx_publication_attempts_job_id ON custom_dim.publication_attempts(job_id);

CREATE TABLE IF NOT EXISTS custom_dim.published_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  job_id uuid NOT NULL UNIQUE REFERENCES custom_dim.publication_jobs(id),
  external_post_id text,
  external_url text,
  published_at timestamptz,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_published_posts_organization ON custom_dim.published_posts(organization_id);
CREATE INDEX IF NOT EXISTS idx_published_posts_job_id ON custom_dim.published_posts(job_id);

CREATE TABLE IF NOT EXISTS custom_dim.publication_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  published_post_id uuid NOT NULL REFERENCES custom_dim.published_posts(id),
  metric_code text NOT NULL,
  metric_value numeric NOT NULL,
  observed_at timestamptz NOT NULL,
  provenance text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_publication_metrics_organization ON custom_dim.publication_metrics(organization_id);
CREATE INDEX IF NOT EXISTS idx_publication_metrics_published_post_id ON custom_dim.publication_metrics(published_post_id);

CREATE TABLE IF NOT EXISTS custom_dim.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  display_name text,
  locale text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_organization ON custom_dim.contacts(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.contact_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  contact_id uuid NOT NULL REFERENCES custom_dim.contacts(id),
  platform_id uuid NOT NULL REFERENCES custom_dim.platforms(id),
  external_identifier_hash text NOT NULL,
  encrypted_reference text,
  verification_status text NOT NULL DEFAULT 'unverified',
  UNIQUE(organization_id,platform_id,external_identifier_hash),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_identities_organization ON custom_dim.contact_identities(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_contact_id ON custom_dim.contact_identities(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_identities_platform_id ON custom_dim.contact_identities(platform_id);

CREATE TABLE IF NOT EXISTS custom_dim.contact_influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  contact_id uuid NOT NULL REFERENCES custom_dim.contacts(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  relationship_status text NOT NULL DEFAULT 'active',
  UNIQUE(contact_id,influencer_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contact_influencers_organization ON custom_dim.contact_influencers(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_influencers_contact_id ON custom_dim.contact_influencers(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_influencers_influencer_id ON custom_dim.contact_influencers(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  contact_id uuid NOT NULL REFERENCES custom_dim.contacts(id),
  channel text NOT NULL,
  purpose text NOT NULL,
  lawful_basis text,
  evidence_ref text,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_records_organization ON custom_dim.consent_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_consent_records_contact_id ON custom_dim.consent_records(contact_id);

CREATE TABLE IF NOT EXISTS custom_dim.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  contact_id uuid NOT NULL REFERENCES custom_dim.contacts(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  external_thread_id text,
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_organization ON custom_dim.conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversations_influencer_id ON custom_dim.conversations(influencer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON custom_dim.conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_social_account_id ON custom_dim.conversations(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  conversation_id uuid NOT NULL REFERENCES custom_dim.conversations(id),
  provider_message_id text,
  direction text NOT NULL CHECK(direction IN ('incoming','outgoing')),
  message_type text NOT NULL DEFAULT 'text',
  body_reference text,
  status text NOT NULL DEFAULT 'received',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_organization ON custom_dim.messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON custom_dim.messages(conversation_id);

CREATE TABLE IF NOT EXISTS custom_dim.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  message_id uuid NOT NULL REFERENCES custom_dim.messages(id),
  storage_object_id uuid NOT NULL REFERENCES custom_dim.storage_objects(id),
  mime_type text,
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_organization ON custom_dim.message_attachments(organization_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON custom_dim.message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_storage_object_id ON custom_dim.message_attachments(storage_object_id);

CREATE TABLE IF NOT EXISTS custom_dim.conversation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  conversation_id uuid NOT NULL REFERENCES custom_dim.conversations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_organization ON custom_dim.conversation_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_assignments_conversation_id ON custom_dim.conversation_assignments(conversation_id);

CREATE TABLE IF NOT EXISTS custom_dim.conversation_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  conversation_id uuid NOT NULL REFERENCES custom_dim.conversations(id),
  author_id uuid NOT NULL REFERENCES auth.users(id),
  note_body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_organization ON custom_dim.conversation_notes(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_conversation_id ON custom_dim.conversation_notes(conversation_id);

CREATE TABLE IF NOT EXISTS custom_dim.automated_response_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  social_account_id uuid NOT NULL REFERENCES custom_dim.social_accounts(id),
  trigger jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  template_id uuid,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_automated_response_rules_organization ON custom_dim.automated_response_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_automated_response_rules_social_account_id ON custom_dim.automated_response_rules(social_account_id);

CREATE TABLE IF NOT EXISTS custom_dim.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  provider text NOT NULL,
  provider_template_id text,
  language text NOT NULL,
  category text,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_message_templates_organization ON custom_dim.message_templates(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  provider text NOT NULL,
  event_id text,
  dedupe_hash text NOT NULL,
  signature_status text NOT NULL,
  payload_reference text,
  processing_state text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_events_organization ON custom_dim.webhook_events(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  name text NOT NULL,
  website_url text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partners_organization ON custom_dim.partners(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  name text NOT NULL,
  partner_id uuid REFERENCES custom_dim.partners(id),
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  currency char(3) NOT NULL DEFAULT 'USD',
  budget numeric(18,2) CHECK(budget>=0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_organization ON custom_dim.campaigns(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_partner_id ON custom_dim.campaigns(partner_id);

CREATE TABLE IF NOT EXISTS custom_dim.campaign_influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  campaign_id uuid NOT NULL REFERENCES custom_dim.campaigns(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  UNIQUE(campaign_id,influencer_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_influencers_organization ON custom_dim.campaign_influencers(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_influencers_campaign_id ON custom_dim.campaign_influencers(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_influencers_influencer_id ON custom_dim.campaign_influencers(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.campaign_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  campaign_id uuid NOT NULL REFERENCES custom_dim.campaigns(id),
  influencer_id uuid NOT NULL REFERENCES custom_dim.influencers(id),
  content_id uuid REFERENCES custom_dim.content_items(id),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'planned',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_organization ON custom_dim.campaign_deliverables(organization_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_campaign_id ON custom_dim.campaign_deliverables(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_influencer_id ON custom_dim.campaign_deliverables(influencer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_content_id ON custom_dim.campaign_deliverables(content_id);

CREATE TABLE IF NOT EXISTS custom_dim.revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  campaign_id uuid REFERENCES custom_dim.campaigns(id),
  influencer_id uuid REFERENCES custom_dim.influencers(id),
  amount numeric(18,2) NOT NULL CHECK(amount>=0),
  currency char(3) NOT NULL,
  source text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revenue_events_organization ON custom_dim.revenue_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_campaign_id ON custom_dim.revenue_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_revenue_events_influencer_id ON custom_dim.revenue_events(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  campaign_id uuid REFERENCES custom_dim.campaigns(id),
  influencer_id uuid REFERENCES custom_dim.influencers(id),
  amount numeric(18,6) NOT NULL CHECK(amount>=0),
  currency char(3) NOT NULL,
  cost_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cost_events_organization ON custom_dim.cost_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_campaign_id ON custom_dim.cost_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cost_events_influencer_id ON custom_dim.cost_events(influencer_id);

CREATE TABLE IF NOT EXISTS custom_dim.system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_system_events_organization ON custom_dim.system_events(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  event_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL,
  aggregate_id uuid,
  correlation_id uuid NOT NULL,
  payload_version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_events_organization ON custom_dim.outbox_events(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id),
  category text NOT NULL,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_organization ON custom_dim.notifications(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  actor_type text NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  before_data jsonb,
  after_data jsonb,
  correlation_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization ON custom_dim.audit_logs(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  severity text NOT NULL,
  category text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  assigned_to uuid REFERENCES auth.users(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_security_incidents_organization ON custom_dim.security_incidents(organization_id);

CREATE TABLE IF NOT EXISTS custom_dim.operation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES custom_dim.organizations(id),
  job_type text NOT NULL,
  subject_type text,
  subject_id uuid,
  status text NOT NULL DEFAULT 'queued',
  queue_name text,
  idempotency_key text,
  correlation_id uuid,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operation_jobs_organization ON custom_dim.operation_jobs(organization_id);

-- Additional indexes and integrity constraints
CREATE UNIQUE INDEX IF NOT EXISTS uq_social_external ON custom_dim.social_accounts(platform_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_account_integration ON custom_dim.account_integrations(social_account_id,connector_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_event ON custom_dim.webhook_events(provider,event_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_hash ON custom_dim.webhook_events(provider,dedupe_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_provider ON custom_dim.messages(conversation_id,provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON custom_dim.outbox_events(occurred_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_due ON custom_dim.publication_jobs(scheduled_at) WHERE status IN ('queued','retry');
CREATE INDEX IF NOT EXISTS idx_accounts_influencer ON custom_dim.social_accounts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_content_influencer ON custom_dim.content_items(influencer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_assignee ON custom_dim.conversations(assigned_to,status);
ALTER TABLE custom_dim.identity_disclosures ADD CONSTRAINT fk_identity_disclosures_platform FOREIGN KEY (platform_id) REFERENCES custom_dim.platforms(id);
ALTER TABLE custom_dim.automated_response_rules ADD CONSTRAINT fk_automated_response_template FOREIGN KEY (template_id) REFERENCES custom_dim.message_templates(id);

-- Enforce tenant consistency for same-organization references in DB, not only API.
CREATE OR REPLACE FUNCTION custom_dim.enforce_tenant_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE target_org uuid; reference_id uuid;
BEGIN
  reference_id := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::uuid;
  IF reference_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT organization_id FROM custom_dim.%I WHERE id = $1', TG_ARGV[1]) INTO target_org USING reference_id;
  IF target_org IS DISTINCT FROM NEW.organization_id THEN RAISE EXCEPTION 'cross-organization reference denied for %.%', TG_TABLE_NAME,TG_ARGV[0] USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_role_assignments_role_id_tenant BEFORE INSERT OR UPDATE OF organization_id,role_id ON custom_dim.role_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('role_id','roles');
CREATE TRIGGER trg_team_members_team_id_tenant BEFORE INSERT OR UPDATE OF organization_id,team_id ON custom_dim.team_members FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('team_id','teams');
CREATE TRIGGER trg_media_licenses_holder_party_id_tenant BEFORE INSERT OR UPDATE OF organization_id,holder_party_id ON custom_dim.media_licenses FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('holder_party_id','legal_parties');
CREATE TRIGGER trg_media_licenses_evidence_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,evidence_object_id ON custom_dim.media_licenses FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('evidence_object_id','storage_objects');
CREATE TRIGGER trg_influencer_profiles_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_profiles FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_personas_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_personas FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_persona_canon_persona_id_tenant BEFORE INSERT OR UPDATE OF organization_id,persona_id ON custom_dim.persona_canon FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('persona_id','influencer_personas');
CREATE TRIGGER trg_influencer_languages_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_languages FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_assignments_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_status_history_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_status_history FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_goals_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_goals FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_contracts_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.influencer_contracts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_influencer_contracts_owner_party_id_tenant BEFORE INSERT OR UPDATE OF organization_id,owner_party_id ON custom_dim.influencer_contracts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('owner_party_id','legal_parties');
CREATE TRIGGER trg_influencer_contracts_storage_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,storage_object_id ON custom_dim.influencer_contracts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('storage_object_id','storage_objects');
CREATE TRIGGER trg_identity_consents_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.identity_consents FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_identity_consents_subject_party_id_tenant BEFORE INSERT OR UPDATE OF organization_id,subject_party_id ON custom_dim.identity_consents FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('subject_party_id','legal_parties');
CREATE TRIGGER trg_identity_consents_evidence_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,evidence_object_id ON custom_dim.identity_consents FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('evidence_object_id','storage_objects');
CREATE TRIGGER trg_identity_assets_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.identity_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_identity_assets_storage_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,storage_object_id ON custom_dim.identity_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('storage_object_id','storage_objects');
CREATE TRIGGER trg_identity_assets_license_id_tenant BEFORE INSERT OR UPDATE OF organization_id,license_id ON custom_dim.identity_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('license_id','media_licenses');
CREATE TRIGGER trg_identity_disclosures_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.identity_disclosures FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_social_accounts_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.social_accounts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_account_integrations_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.account_integrations FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_account_capabilities_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.account_capabilities FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_account_permissions_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.account_permissions FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_account_provisioning_tasks_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.account_provisioning_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_account_provisioning_tasks_evidence_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,evidence_object_id ON custom_dim.account_provisioning_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('evidence_object_id','storage_objects');
CREATE TRIGGER trg_account_health_checks_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.account_health_checks FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_onboarding_sessions_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.onboarding_sessions FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_onboarding_steps_session_id_tenant BEFORE INSERT OR UPDATE OF organization_id,session_id ON custom_dim.onboarding_steps FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('session_id','onboarding_sessions');
CREATE TRIGGER trg_onboarding_tasks_session_id_tenant BEFORE INSERT OR UPDATE OF organization_id,session_id ON custom_dim.onboarding_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('session_id','onboarding_sessions');
CREATE TRIGGER trg_onboarding_tasks_evidence_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,evidence_object_id ON custom_dim.onboarding_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('evidence_object_id','storage_objects');
CREATE TRIGGER trg_onboarding_approvals_session_id_tenant BEFORE INSERT OR UPDATE OF organization_id,session_id ON custom_dim.onboarding_approvals FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('session_id','onboarding_sessions');
CREATE TRIGGER trg_onboarding_events_session_id_tenant BEFORE INSERT OR UPDATE OF organization_id,session_id ON custom_dim.onboarding_events FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('session_id','onboarding_sessions');
CREATE TRIGGER trg_agent_assignments_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.agent_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_agent_assignments_model_config_id_tenant BEFORE INSERT OR UPDATE OF organization_id,model_config_id ON custom_dim.agent_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('model_config_id','ai_model_configs');
CREATE TRIGGER trg_agent_assignments_approval_policy_id_tenant BEFORE INSERT OR UPDATE OF organization_id,approval_policy_id ON custom_dim.agent_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('approval_policy_id','approval_policies');
CREATE TRIGGER trg_knowledge_sources_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.knowledge_sources FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_agent_runs_agent_assignment_id_tenant BEFORE INSERT OR UPDATE OF organization_id,agent_assignment_id ON custom_dim.agent_runs FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('agent_assignment_id','agent_assignments');
CREATE TRIGGER trg_agent_runs_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.agent_runs FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_editorial_topics_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.editorial_topics FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_content_items_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.content_items FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_content_items_topic_id_tenant BEFORE INSERT OR UPDATE OF organization_id,topic_id ON custom_dim.content_items FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('topic_id','editorial_topics');
CREATE TRIGGER trg_content_versions_content_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_id ON custom_dim.content_versions FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_id','content_items');
CREATE TRIGGER trg_content_sources_content_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_id ON custom_dim.content_sources FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_id','content_items');
CREATE TRIGGER trg_content_assets_content_version_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_version_id ON custom_dim.content_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_version_id','content_versions');
CREATE TRIGGER trg_content_assets_storage_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,storage_object_id ON custom_dim.content_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('storage_object_id','storage_objects');
CREATE TRIGGER trg_content_approvals_content_version_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_version_id ON custom_dim.content_approvals FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_version_id','content_versions');
CREATE TRIGGER trg_editorial_calendar_items_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.editorial_calendar_items FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_editorial_calendar_items_content_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_id ON custom_dim.editorial_calendar_items FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_id','content_items');
CREATE TRIGGER trg_editorial_calendar_items_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.editorial_calendar_items FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_publication_jobs_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.publication_jobs FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_publication_jobs_content_version_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_version_id ON custom_dim.publication_jobs FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_version_id','content_versions');
CREATE TRIGGER trg_publication_jobs_approval_id_tenant BEFORE INSERT OR UPDATE OF organization_id,approval_id ON custom_dim.publication_jobs FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('approval_id','content_approvals');
CREATE TRIGGER trg_publication_attempts_job_id_tenant BEFORE INSERT OR UPDATE OF organization_id,job_id ON custom_dim.publication_attempts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('job_id','publication_jobs');
CREATE TRIGGER trg_published_posts_job_id_tenant BEFORE INSERT OR UPDATE OF organization_id,job_id ON custom_dim.published_posts FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('job_id','publication_jobs');
CREATE TRIGGER trg_publication_metrics_published_post_id_tenant BEFORE INSERT OR UPDATE OF organization_id,published_post_id ON custom_dim.publication_metrics FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('published_post_id','published_posts');
CREATE TRIGGER trg_contact_identities_contact_id_tenant BEFORE INSERT OR UPDATE OF organization_id,contact_id ON custom_dim.contact_identities FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('contact_id','contacts');
CREATE TRIGGER trg_contact_influencers_contact_id_tenant BEFORE INSERT OR UPDATE OF organization_id,contact_id ON custom_dim.contact_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('contact_id','contacts');
CREATE TRIGGER trg_contact_influencers_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.contact_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_consent_records_contact_id_tenant BEFORE INSERT OR UPDATE OF organization_id,contact_id ON custom_dim.consent_records FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('contact_id','contacts');
CREATE TRIGGER trg_conversations_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.conversations FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_conversations_contact_id_tenant BEFORE INSERT OR UPDATE OF organization_id,contact_id ON custom_dim.conversations FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('contact_id','contacts');
CREATE TRIGGER trg_conversations_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.conversations FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_messages_conversation_id_tenant BEFORE INSERT OR UPDATE OF organization_id,conversation_id ON custom_dim.messages FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('conversation_id','conversations');
CREATE TRIGGER trg_message_attachments_message_id_tenant BEFORE INSERT OR UPDATE OF organization_id,message_id ON custom_dim.message_attachments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('message_id','messages');
CREATE TRIGGER trg_message_attachments_storage_object_id_tenant BEFORE INSERT OR UPDATE OF organization_id,storage_object_id ON custom_dim.message_attachments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('storage_object_id','storage_objects');
CREATE TRIGGER trg_conversation_assignments_conversation_id_tenant BEFORE INSERT OR UPDATE OF organization_id,conversation_id ON custom_dim.conversation_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('conversation_id','conversations');
CREATE TRIGGER trg_conversation_notes_conversation_id_tenant BEFORE INSERT OR UPDATE OF organization_id,conversation_id ON custom_dim.conversation_notes FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('conversation_id','conversations');
CREATE TRIGGER trg_automated_response_rules_social_account_id_tenant BEFORE INSERT OR UPDATE OF organization_id,social_account_id ON custom_dim.automated_response_rules FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('social_account_id','social_accounts');
CREATE TRIGGER trg_campaigns_partner_id_tenant BEFORE INSERT OR UPDATE OF organization_id,partner_id ON custom_dim.campaigns FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('partner_id','partners');
CREATE TRIGGER trg_campaign_influencers_campaign_id_tenant BEFORE INSERT OR UPDATE OF organization_id,campaign_id ON custom_dim.campaign_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('campaign_id','campaigns');
CREATE TRIGGER trg_campaign_influencers_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.campaign_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_campaign_deliverables_campaign_id_tenant BEFORE INSERT OR UPDATE OF organization_id,campaign_id ON custom_dim.campaign_deliverables FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('campaign_id','campaigns');
CREATE TRIGGER trg_campaign_deliverables_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.campaign_deliverables FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_campaign_deliverables_content_id_tenant BEFORE INSERT OR UPDATE OF organization_id,content_id ON custom_dim.campaign_deliverables FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('content_id','content_items');
CREATE TRIGGER trg_revenue_events_campaign_id_tenant BEFORE INSERT OR UPDATE OF organization_id,campaign_id ON custom_dim.revenue_events FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('campaign_id','campaigns');
CREATE TRIGGER trg_revenue_events_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.revenue_events FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');
CREATE TRIGGER trg_cost_events_campaign_id_tenant BEFORE INSERT OR UPDATE OF organization_id,campaign_id ON custom_dim.cost_events FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('campaign_id','campaigns');
CREATE TRIGGER trg_cost_events_influencer_id_tenant BEFORE INSERT OR UPDATE OF organization_id,influencer_id ON custom_dim.cost_events FOR EACH ROW EXECUTE FUNCTION custom_dim.enforce_tenant_reference('influencer_id','influencers');

-- Timestamp triggers
CREATE TRIGGER trg_organizations_updated BEFORE UPDATE ON custom_dim.organizations FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_user_profiles_updated BEFORE UPDATE ON custom_dim.user_profiles FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_organization_members_updated BEFORE UPDATE ON custom_dim.organization_members FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_organization_settings_updated BEFORE UPDATE ON custom_dim.organization_settings FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_roles_updated BEFORE UPDATE ON custom_dim.roles FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_permissions_updated BEFORE UPDATE ON custom_dim.permissions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_role_permissions_updated BEFORE UPDATE ON custom_dim.role_permissions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_role_assignments_updated BEFORE UPDATE ON custom_dim.role_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_teams_updated BEFORE UPDATE ON custom_dim.teams FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_team_members_updated BEFORE UPDATE ON custom_dim.team_members FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_approval_policies_updated BEFORE UPDATE ON custom_dim.approval_policies FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_storage_objects_updated BEFORE UPDATE ON custom_dim.storage_objects FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_legal_parties_updated BEFORE UPDATE ON custom_dim.legal_parties FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_media_licenses_updated BEFORE UPDATE ON custom_dim.media_licenses FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencers_updated BEFORE UPDATE ON custom_dim.influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_profiles_updated BEFORE UPDATE ON custom_dim.influencer_profiles FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_personas_updated BEFORE UPDATE ON custom_dim.influencer_personas FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_persona_canon_updated BEFORE UPDATE ON custom_dim.persona_canon FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_languages_updated BEFORE UPDATE ON custom_dim.influencer_languages FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_assignments_updated BEFORE UPDATE ON custom_dim.influencer_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_goals_updated BEFORE UPDATE ON custom_dim.influencer_goals FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_influencer_contracts_updated BEFORE UPDATE ON custom_dim.influencer_contracts FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_identity_consents_updated BEFORE UPDATE ON custom_dim.identity_consents FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_identity_assets_updated BEFORE UPDATE ON custom_dim.identity_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_identity_disclosures_updated BEFORE UPDATE ON custom_dim.identity_disclosures FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_platforms_updated BEFORE UPDATE ON custom_dim.platforms FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_connectors_updated BEFORE UPDATE ON custom_dim.connectors FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_social_accounts_updated BEFORE UPDATE ON custom_dim.social_accounts FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_account_integrations_updated BEFORE UPDATE ON custom_dim.account_integrations FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_account_capabilities_updated BEFORE UPDATE ON custom_dim.account_capabilities FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_account_permissions_updated BEFORE UPDATE ON custom_dim.account_permissions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_account_provisioning_tasks_updated BEFORE UPDATE ON custom_dim.account_provisioning_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_onboarding_sessions_updated BEFORE UPDATE ON custom_dim.onboarding_sessions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_onboarding_steps_updated BEFORE UPDATE ON custom_dim.onboarding_steps FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_onboarding_tasks_updated BEFORE UPDATE ON custom_dim.onboarding_tasks FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_onboarding_approvals_updated BEFORE UPDATE ON custom_dim.onboarding_approvals FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_ai_model_configs_updated BEFORE UPDATE ON custom_dim.ai_model_configs FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_agent_definitions_updated BEFORE UPDATE ON custom_dim.agent_definitions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_agent_assignments_updated BEFORE UPDATE ON custom_dim.agent_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_knowledge_sources_updated BEFORE UPDATE ON custom_dim.knowledge_sources FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_editorial_topics_updated BEFORE UPDATE ON custom_dim.editorial_topics FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_content_items_updated BEFORE UPDATE ON custom_dim.content_items FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_content_versions_updated BEFORE UPDATE ON custom_dim.content_versions FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_content_sources_updated BEFORE UPDATE ON custom_dim.content_sources FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_content_assets_updated BEFORE UPDATE ON custom_dim.content_assets FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_content_approvals_updated BEFORE UPDATE ON custom_dim.content_approvals FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_editorial_calendar_items_updated BEFORE UPDATE ON custom_dim.editorial_calendar_items FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_publication_jobs_updated BEFORE UPDATE ON custom_dim.publication_jobs FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_published_posts_updated BEFORE UPDATE ON custom_dim.published_posts FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON custom_dim.contacts FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_contact_identities_updated BEFORE UPDATE ON custom_dim.contact_identities FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_contact_influencers_updated BEFORE UPDATE ON custom_dim.contact_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_consent_records_updated BEFORE UPDATE ON custom_dim.consent_records FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON custom_dim.conversations FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_messages_updated BEFORE UPDATE ON custom_dim.messages FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_message_attachments_updated BEFORE UPDATE ON custom_dim.message_attachments FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_conversation_assignments_updated BEFORE UPDATE ON custom_dim.conversation_assignments FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_conversation_notes_updated BEFORE UPDATE ON custom_dim.conversation_notes FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_automated_response_rules_updated BEFORE UPDATE ON custom_dim.automated_response_rules FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_message_templates_updated BEFORE UPDATE ON custom_dim.message_templates FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_partners_updated BEFORE UPDATE ON custom_dim.partners FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_campaigns_updated BEFORE UPDATE ON custom_dim.campaigns FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_campaign_influencers_updated BEFORE UPDATE ON custom_dim.campaign_influencers FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_campaign_deliverables_updated BEFORE UPDATE ON custom_dim.campaign_deliverables FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_notifications_updated BEFORE UPDATE ON custom_dim.notifications FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();
CREATE TRIGGER trg_operation_jobs_updated BEFORE UPDATE ON custom_dim.operation_jobs FOR EACH ROW EXECUTE FUNCTION custom_dim.set_updated_at();

-- Least privilege: no direct client DML for sensitive custom schema tables.
REVOKE ALL ON ALL TABLES IN SCHEMA custom_dim FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA custom_dim FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA custom_dim TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA custom_dim TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA custom_dim REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA custom_dim GRANT ALL ON TABLES TO service_role;
-- RLS defence in depth: service_role bypasses RLS, therefore backend must enforce RBAC and audit.
ALTER TABLE custom_dim.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.storage_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.legal_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.media_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.persona_canon ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_languages ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.influencer_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.identity_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.identity_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.identity_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.account_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.account_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.account_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.account_provisioning_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.account_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.onboarding_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.onboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.ai_model_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.agent_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.agent_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.knowledge_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.editorial_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.content_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.editorial_calendar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.publication_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.publication_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.published_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.publication_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.contact_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.contact_influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.conversation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.automated_response_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.campaign_influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.campaign_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.revenue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.system_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_dim.operation_jobs ENABLE ROW LEVEL SECURITY;

-- Read-only authenticated tenant directory is optional. Leave schema PRIVATE by default.
-- If PostgREST exposure is intentionally enabled later, review per-table GRANTs and RLS in a separate migration.
-- Append-only protections for audit. Only DB maintenance owner can bypass; service_role must not update/delete.
REVOKE UPDATE, DELETE, TRUNCATE ON custom_dim.audit_logs FROM service_role;
-- outbox requires authorized updates of processed_at by consumer; prevent arbitrary deletions in backend policy.
REVOKE DELETE, TRUNCATE ON custom_dim.outbox_events FROM service_role;
-- Reminder: migrate audit/outbox writes through controlled backend functions or dedicated DB roles.
COMMIT;
