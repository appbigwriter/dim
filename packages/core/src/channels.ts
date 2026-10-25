import type { Actor } from "../../contracts/src/index";
import type { DB } from "../../db/src/index";
import { authorize, resource, visible } from "./security";
export const channelCoverage = [
  {
    code: "cms",
    name: "Blogs",
    implementation: "catalog_only",
    capabilities: [],
  },
  {
    code: "instagram",
    name: "Instagram",
    implementation: "catalog_only",
    capabilities: [],
  },
  {
    code: "facebook",
    name: "Facebook",
    implementation: "catalog_only",
    capabilities: [],
  },
  {
    code: "x",
    name: "X",
    implementation: "local_partial",
    capabilities: ["oauth2", "publish_text", "public_metrics"],
  },
  {
    code: "whatsapp",
    name: "WhatsApp",
    implementation: "local_partial",
    capabilities: [
      "official_auth",
      "webhooks",
      "send_messages",
      "body_templates",
    ],
  },
  {
    code: "telegram",
    name: "Telegram",
    implementation: "local_partial",
    capabilities: ["bot_auth", "publish_text", "webhooks", "send_messages"],
  },
  {
    code: "email",
    name: "E-mail",
    implementation: "catalog_only",
    capabilities: [],
  },
  {
    code: "youtube",
    name: "YouTube",
    implementation: "catalog_only",
    capabilities: [],
  },
  {
    code: "crm",
    name: "CRM interno",
    implementation: "local_partial",
    capabilities: [
      "contacts",
      "consents",
      "manual_link",
      "export",
      "inbox",
      "handoff",
    ],
  },
] as const;
export async function identityChannels(db: DB, actor: Actor, id: string) {
  await resource(db, "influencers", id, actor);
  authorize(actor, "identity.read", { influencerId: id });
  const accounts = (
    await db.query(
      "SELECT a.id,a.influencer_id,a.account_type,a.handle,a.account_status,a.integration_status,p.code AS provider FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE a.organization_id=$1 AND a.influencer_id=$2",
      [actor.organizationId, id],
    )
  ).rows.filter((a) => visible(actor, "accounts.read", a));
  const minimum: Record<string, string> = {
    cms: "publish_article",
    instagram: "publish_media",
    facebook: "publish_text",
    x: "publish_text",
    whatsapp: "send_messages",
    telegram: "publish_text",
    email: "send_email",
    youtube: "publish_video",
  };
  const data = channelCoverage.map((c) => {
    const linked = accounts.filter((a) => a.provider === c.code);
    const connected = linked.some(
      (a) =>
        a.account_status === "active" && a.integration_status === "connected",
    );
    const blockers =
      c.code === "crm"
        ? []
        : [
            ...(c.implementation === "catalog_only"
              ? ["adapter_not_implemented"]
              : []),
            ...(!linked.length
              ? ["account_not_linked"]
              : !connected
                ? ["account_not_connected"]
                : []),
          ];
    return {
      ...c,
      required: true,
      minimum_capability: minimum[c.code] || "contacts_and_consents",
      accounts: linked,
      connected_record: connected,
      blockers,
      ready_for_configuration: !blockers.length,
    };
  });
  return {
    influencer_id: id,
    homologation: "not_verified",
    full_operation_ready: false,
    requirements_satisfied: data.every((c) => c.ready_for_configuration),
    data,
  };
}
