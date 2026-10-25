import { z } from "zod";
import {
  uuid,
  text,
  timestamp,
  json,
  identityInput,
  demand,
  type Actor,
} from "../../contracts/src/index";
import { insert, type DB } from "../../db/src/index";
import { audit, authorize, member, resource, event } from "./security";
const optionalDate = timestamp.optional();
const money = z.string().regex(/^\d{1,12}(\.\d{1,6})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
type Definition = {
  table: string;
  permission: string;
  schema: z.ZodObject<any>;
  refs?: Record<string, string>;
  search?: string;
  immutable?: boolean;
};
export const resources: Record<string, Definition> = {
  influencers: {
    table: "influencers",
    permission: "identity",
    schema: identityInput,
    search: "public_name",
  },
  contracts: {
    table: "influencer_contracts",
    permission: "governance",
    schema: z.object({
      influencer_id: uuid,
      owner_party_id: uuid,
      contract_type: text,
      version: z.number().int().positive(),
      starts_at: timestamp,
      ends_at: timestamp,
      terms: json,
      storage_object_id: uuid,
      status: z.enum(["draft", "signed"]),
    }),
    refs: {
      influencer_id: "influencers",
      owner_party_id: "legal_parties",
      storage_object_id: "storage_objects",
    },
  },
  "legal-parties": {
    table: "legal_parties",
    permission: "governance",
    schema: z.object({
      party_type: z.enum(["person", "company"]),
      display_name: text,
      country_code: z.string().length(2).optional(),
    }),
    search: "display_name",
  },
  "identity-consents": {
    table: "identity_consents",
    permission: "governance",
    schema: z.object({
      influencer_id: uuid,
      subject_party_id: uuid,
      use_type: text,
      scope: json,
      evidence_object_id: uuid,
      granted_at: timestamp,
      expires_at: optionalDate,
    }),
    refs: {
      influencer_id: "influencers",
      subject_party_id: "legal_parties",
      evidence_object_id: "storage_objects",
    },
    immutable: true,
  },
  assets: {
    table: "identity_assets",
    permission: "governance",
    schema: z.object({
      influencer_id: uuid,
      storage_object_id: uuid,
      license_id: uuid,
      asset_type: text,
      provenance: json,
    }),
    refs: {
      influencer_id: "influencers",
      storage_object_id: "storage_objects",
      license_id: "media_licenses",
    },
  },
  licenses: {
    table: "media_licenses",
    permission: "governance",
    schema: z.object({
      license_type: text,
      holder_party_id: uuid,
      terms: json,
      evidence_object_id: uuid,
      valid_until: timestamp,
    }),
    refs: {
      holder_party_id: "legal_parties",
      evidence_object_id: "storage_objects",
    },
  },
  disclosures: {
    table: "identity_disclosures",
    permission: "governance",
    schema: z.object({
      influencer_id: uuid,
      platform_id: uuid,
      disclosure_type: text,
      disclosure_text: text,
      policy_version: z.number().int().positive(),
      enabled: z.boolean(),
    }),
    refs: { influencer_id: "influencers" },
  },
  accounts: {
    table: "social_accounts",
    permission: "accounts",
    schema: z.object({
      influencer_id: uuid,
      platform_id: uuid,
      account_type: z.enum([
        "page",
        "profile",
        "bot",
        "channel",
        "business_phone",
        "blog",
        "email",
      ]),
      external_id: text.optional(),
      handle: text,
      public_url: z.url({ protocol: /^https$/ }).optional(),
      owner_reference: text,
      recovery_owner_id: uuid,
    }),
    refs: { influencer_id: "influencers" },
    search: "handle",
  },
  topics: {
    table: "editorial_topics",
    permission: "editorial",
    schema: z.object({
      influencer_id: uuid,
      title: text,
      source_notes: z.array(z.url({ protocol: /^https$/ })),
    }),
    refs: { influencer_id: "influencers" },
    search: "title",
  },
  contents: {
    table: "content_items",
    permission: "editorial",
    schema: z.object({
      influencer_id: uuid,
      topic_id: uuid.optional(),
      title: text,
      content_type: z.enum(["text", "article", "caption"]),
      objective: text,
    }),
    refs: { influencer_id: "influencers", topic_id: "editorial_topics" },
    search: "title",
  },
  contacts: {
    table: "contacts",
    permission: "inbox",
    schema: z.object({
      display_name: text,
      locale: z.enum(["pt-BR", "en", "es"]),
    }),
    search: "display_name",
  },
  consents: {
    table: "consent_records",
    permission: "inbox",
    schema: z.object({
      contact_id: uuid,
      channel: z.enum(["telegram", "whatsapp", "email"]),
      purpose: z.enum(["marketing", "service"]),
      lawful_basis: text,
      evidence_ref: text,
      granted_at: timestamp,
      expires_at: optionalDate,
    }),
    refs: { contact_id: "contacts" },
    immutable: true,
  },
  conversations: {
    table: "conversations",
    permission: "inbox",
    schema: z.object({
      influencer_id: uuid,
      contact_id: uuid,
      social_account_id: uuid,
      external_thread_id: text.optional(),
    }),
    refs: {
      influencer_id: "influencers",
      contact_id: "contacts",
      social_account_id: "social_accounts",
    },
  },
  templates: {
    table: "message_templates",
    permission: "inbox",
    schema: z.object({
      provider: z.enum(["whatsapp", "telegram"]),
      provider_template_id: text.optional(),
      language: text,
      category: text,
      content: json,
    }),
  },
  campaigns: {
    table: "campaigns",
    permission: "commercial",
    schema: z.object({
      name: text,
      partner_id: uuid,
      starts_at: timestamp,
      ends_at: timestamp,
      currency,
      budget: money,
    }),
    refs: { partner_id: "partners" },
    search: "name",
  },
  partners: {
    table: "partners",
    permission: "commercial",
    schema: z.object({
      name: text,
      website_url: z.url({ protocol: /^https$/ }).optional(),
    }),
    search: "name",
  },
  deliverables: {
    table: "campaign_deliverables",
    permission: "commercial",
    schema: z.object({
      campaign_id: uuid,
      influencer_id: uuid,
      content_id: uuid.optional(),
      due_at: timestamp,
    }),
    refs: {
      campaign_id: "campaigns",
      influencer_id: "influencers",
      content_id: "content_items",
    },
  },
  revenues: {
    table: "revenue_events",
    permission: "commercial",
    schema: z.object({
      campaign_id: uuid.optional(),
      influencer_id: uuid,
      amount: money,
      currency,
      source: text,
      occurred_at: timestamp,
    }),
    refs: { campaign_id: "campaigns", influencer_id: "influencers" },
    immutable: true,
  },
  costs: {
    table: "cost_events",
    permission: "commercial",
    schema: z.object({
      campaign_id: uuid.optional(),
      influencer_id: uuid,
      amount: money,
      currency,
      cost_type: text,
      occurred_at: timestamp,
    }),
    refs: { campaign_id: "campaigns", influencer_id: "influencers" },
    immutable: true,
  },
  teams: {
    table: "teams",
    permission: "security",
    schema: z.object({ name: text }),
  },
  incidents: {
    table: "security_incidents",
    permission: "security",
    schema: z.object({
      severity: z.enum(["low", "medium", "high", "critical"]),
      category: text,
      assigned_to: uuid.optional(),
    }),
  },
  "onboarding-tasks": {
    table: "onboarding_tasks",
    permission: "identity",
    schema: z.object({
      session_id: uuid,
      task_code: text,
      assignee_id: uuid,
      due_at: optionalDate,
      evidence_object_id: uuid.optional(),
    }),
    refs: {
      session_id: "onboarding_sessions",
      evidence_object_id: "storage_objects",
    },
  },
  "account-tasks": {
    table: "account_provisioning_tasks",
    permission: "accounts",
    schema: z.object({
      social_account_id: uuid,
      task_key: text,
      assignee_id: uuid,
      evidence_object_id: uuid.optional(),
    }),
    refs: {
      social_account_id: "social_accounts",
      evidence_object_id: "storage_objects",
    },
  },
  "model-configs": {
    table: "ai_model_configs",
    permission: "agents",
    schema: z.object({
      provider: z.literal("openai"),
      model_id: text,
      parameters: json,
      cost_policy: z.object({
        currency,
        budget: money,
        max_tokens: z.number().int().min(1).max(10000),
        input_per_million: money,
        output_per_million: money,
      }),
    }),
  },
  "agent-assignments": {
    table: "agent_assignments",
    permission: "agents",
    schema: z.object({
      influencer_id: uuid,
      agent_id: uuid,
      model_config_id: uuid,
      approval_policy_id: uuid,
      settings: json,
    }),
    refs: {
      influencer_id: "influencers",
      model_config_id: "ai_model_configs",
      approval_policy_id: "approval_policies",
    },
  },
};
// Tables reachable only through validated commands remain read-only in the resource API.
export const readResources: Record<
  string,
  { table: string; permission: string }
> = {
  ...Object.fromEntries(
    Object.entries(resources).map(([key, r]) => [
      key,
      { table: r.table, permission: r.permission },
    ]),
  ),
  publications: { table: "publication_jobs", permission: "publication" },
  approvals: { table: "content_approvals", permission: "approval" },
  audit: { table: "audit_logs", permission: "security" },
  "agent-runs": { table: "agent_runs", permission: "agents" },
  "onboarding-sessions": {
    table: "onboarding_sessions",
    permission: "identity",
  },
  "storage-objects": { table: "storage_objects", permission: "governance" },
  policies: { table: "approval_policies", permission: "security" },
  users: { table: "organization_members", permission: "security" },
  roles: { table: "roles", permission: "security" },
  "role-assignments": { table: "role_assignments", permission: "security" },
};
export async function createResource(
  db: DB,
  actor: Actor,
  key: string,
  input: unknown,
) {
  const def = resources[key];
  const data = def.schema.strict().parse(input) as Record<string, any>;
  for (const [field, table] of Object.entries(def.refs || {})) {
    if (data[field]) {
      const parent = await resource(db, table, data[field], actor);
      if (data.influencer_id && parent.influencer_id)
        demand(
          parent.influencer_id === data.influencer_id,
          "INFLUENCER_SCOPE_MISMATCH",
          "Referência pertence a outra identidade",
          403,
        );
      if (table === "storage_objects")
        demand(
          parent.scan_status === "clean",
          "FILE_NOT_CLEAN",
          "Arquivo ainda não liberado pelo antivírus",
        );
    }
  }
  authorize(actor, `${def.permission}.write`, {
    influencerId: data.influencer_id,
    accountId: data.social_account_id,
  });
  for (const field of [
    "owner_user_id",
    "recovery_owner_id",
    "assignee_id",
    "assigned_to",
  ])
    if (data[field]) await member(db, actor, data[field]);
  if (key === "influencers") {
    data.code = data.slug;
    data.persona_source = "audience_builder";
  }
  if (key === "contents") data.created_by = actor.userId;
  if (data.ends_at && data.starts_at)
    demand(
      new Date(data.ends_at) > new Date(data.starts_at),
      "INVALID_DATE_RANGE",
      "Fim deve ser posterior ao início",
    );
  const row = await insert(db, def.table, {
    ...data,
    organization_id: actor.organizationId,
  });
  if (key === "deliverables")
    await db.query(
      "INSERT INTO custom_dim.campaign_influencers(organization_id,campaign_id,influencer_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [actor.organizationId, data.campaign_id, data.influencer_id],
    );
  await audit(db, actor, "create", def.table, row.id, row);
  if (key === "influencers") {
    const session = await insert(db, "onboarding_sessions", {
      organization_id: actor.organizationId,
      influencer_id: row.id,
      initiated_by: actor.userId,
    });
    for (const step of [
      "identity",
      "rights",
      "approval",
      "infrastructure",
      "accounts",
      "editorial",
      "tests",
      "activation",
    ])
      await insert(db, "onboarding_steps", {
        organization_id: actor.organizationId,
        session_id: session.id,
        step_code: step,
      });
    await event(db, actor, "identity.onboard", row.id, {
      session_id: session.id,
    });
  }
  if (key === "accounts")
    for (const task of [
      "official_registration",
      "ownership_evidence",
      "authorization",
      "non_destructive_test",
    ])
      await insert(db, "account_provisioning_tasks", {
        organization_id: actor.organizationId,
        social_account_id: row.id,
        task_key: task,
        assignee_id: actor.userId,
      });
  return row;
}
