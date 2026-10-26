import type { Actor } from "../../contracts/src/index";
import type { DB } from "../../db/src/index";
import { authorize, resource, visible } from "./security";
export const channelCoverage = [
  {
    code: "cms",
    name: "Blogs",
    implementation: "local_partial",
    capabilities: [
      "audience_context",
      "approved_actions",
      "publish_article",
      "wordpress_transport",
    ],
  },
  {
    code: "instagram",
    name: "Instagram",
    implementation: "local_partial",
    capabilities: ["official_health", "publish_media", "private_media"],
  },
  {
    code: "facebook",
    name: "Facebook",
    implementation: "local_partial",
    capabilities: ["official_health", "publish_text"],
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
      "header_templates",
      "button_templates",
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
    implementation: "local_partial",
    capabilities: ["verified_sender", "consented_reply", "send_messages"],
  },
  {
    code: "youtube",
    name: "YouTube",
    implementation: "local_partial",
    capabilities: [
      "official_health",
      "publish_video",
      "private_media",
      "resumable_upload",
    ],
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
      "filters",
      "sla_escalation",
      "privacy_review",
      "operational_erasure",
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
  const verifiedCapabilities = accounts.length
    ? (
        await db.query(
          "SELECT c.social_account_id,c.capability_code FROM custom_dim.account_capabilities c JOIN custom_dim.account_integrations i ON i.social_account_id=c.social_account_id WHERE c.organization_id=$1 AND c.available=true AND c.checked_at>now()-interval '24 hours' AND i.status='active' AND i.last_tested_at>now()-interval '24 hours' AND (i.expires_at IS NULL OR i.expires_at>now())",
          [actor.organizationId],
        )
      ).rows.filter((c) => accounts.some((a) => a.id === c.social_account_id))
    : [];
  const minimum: Record<string, string> = {
    cms: "publish_article",
    instagram: "publish_media",
    facebook: "publish_text",
    x: "publish_text",
    whatsapp: "send_messages",
    telegram: "publish_text",
    email: "send_messages",
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
            ...(!linked.some(
              (a) =>
                a.account_status === "active" &&
                a.integration_status === "connected" &&
                verifiedCapabilities.some(
                  (cap) =>
                    cap.social_account_id === a.id &&
                    cap.capability_code === minimum[c.code],
                ),
            )
              ? ["capability_not_verified"]
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
