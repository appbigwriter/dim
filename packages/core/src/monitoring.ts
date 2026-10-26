import { demand, AppError } from "../../contracts/src/index";
import {
  channelHealth,
  channelCapabilityCode,
} from "../../connectors/src/channels";
import { ResendEmail } from "../../connectors/src/email";
import { insert, one, type Database } from "../../db/src/index";
import {
  TelegramConnector,
  XConnector,
  whatsappHealth,
  type Vault,
} from "../../connectors/src/index";
export type HealthProbe = (
  provider: string,
  token: string,
  destination: string,
  secret: Record<string, string>,
) => Promise<{
  publish: boolean;
  readMessages: boolean;
  sendMessages: boolean;
}>;
const probe: HealthProbe = async (provider, token, destination, secret) =>
  provider === "whatsapp"
    ? whatsappHealth(token, destination, secret.app_access_token)
    : provider === "telegram"
      ? new TelegramConnector().health(token, destination)
      : provider === "x"
        ? new XConnector().health(token, destination)
        : provider === "email" && secret.provider === "resend"
          ? new ResendEmail(secret).health(destination)
          : channelHealth(provider, secret, destination);
export async function monitorAccounts(
  db: Database,
  vault: Vault,
  check: HealthProbe = probe,
  mediaConfigured = false,
) {
  const accounts = (
    await db.query(
      "SELECT a.*,p.code AS provider,i.id AS integration_id,i.secret_ref,i.granted_scopes,i.expires_at FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id JOIN custom_dim.account_integrations i ON i.social_account_id=a.id AND i.status='active' WHERE a.account_status='active' AND p.code IN('x','telegram','whatsapp','facebook','instagram','youtube','cms','email') AND (i.last_tested_at IS NULL OR i.last_tested_at<now()-interval '5 minutes') ORDER BY i.last_tested_at NULLS FIRST LIMIT 50",
    )
  ).rows;
  for (const account of accounts) {
    let capabilities: any;
    let failure = "";
    try {
      demand(
        !account.expires_at || new Date(account.expires_at) > new Date(),
        "TOKEN_EXPIRED",
        "Autorização expirada",
      );
      demand(
        account.secret_ref.startsWith(
          `dim/${account.organization_id}/${account.id}/`,
        ),
        "VAULT_SCOPE",
        "Referência inválida",
      );
      const secret = await vault.get(account.secret_ref);
      capabilities = await check(
        account.provider,
        secret.token,
        account.external_id,
        {
          ...secret,
          media_transport_ready: mediaConfigured ? "true" : "false",
        },
      );
      if (account.provider === "x")
        capabilities.publish =
          account.granted_scopes?.includes("tweet.write") === true;
    } catch (error) {
      failure = error instanceof AppError ? error.code : "HEALTH_UNAVAILABLE";
    }
    await db.transaction(async (tx) => {
      // Never revive an integration revoked while the provider request was running.
      const current = await one(
        tx,
        "SELECT i.id FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id WHERE i.id=$1 AND i.status='active' AND a.account_status='active' FOR UPDATE OF i,a",
        [account.integration_id],
      );
      if (!current) return;
      await insert(tx, "account_health_checks", {
        organization_id: account.organization_id,
        social_account_id: account.id,
        capability: "official_health",
        status: failure ? "failed" : "healthy",
        response_code: failure || "OK",
      });
      await tx.query(
        "UPDATE custom_dim.account_integrations SET last_tested_at=now() WHERE id=$1",
        [account.integration_id],
      );
      await tx.query(
        "UPDATE custom_dim.social_accounts SET integration_status=$1 WHERE id=$2",
        [failure ? "degraded" : "connected", account.id],
      );
      for (const [code, available] of Object.entries({
        [channelCapabilityCode(account.provider)]: !!capabilities?.publish,
        read_messages: !!capabilities?.readMessages,
        send_messages: !!capabilities?.sendMessages,
      }))
        await tx.query(
          "INSERT INTO custom_dim.account_capabilities(organization_id,social_account_id,capability_code,available,checked_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(social_account_id,capability_code) DO UPDATE SET available=excluded.available,checked_at=now()",
          [account.organization_id, account.id, code, !failure && available],
        );
    });
  }
  return { checked: accounts.length };
}
export async function collectMetrics(
  db: Database,
  vault: Vault,
  request: typeof fetch = fetch,
) {
  const posts = (
    await db.query(
      "SELECT p.*,a.id AS account_id,a.organization_id,a.external_id,i.secret_ref FROM custom_dim.published_posts p JOIN custom_dim.publication_jobs j ON j.id=p.job_id JOIN custom_dim.social_accounts a ON a.id=j.social_account_id JOIN custom_dim.platforms platform ON platform.id=a.platform_id JOIN custom_dim.account_integrations i ON i.social_account_id=a.id AND i.status='active' WHERE p.state='published' AND platform.code='x' AND a.account_status='active' AND (i.expires_at IS NULL OR i.expires_at>now()) AND (p.metrics_attempted_at IS NULL OR p.metrics_attempted_at<now()-interval '15 minutes') ORDER BY p.metrics_attempted_at NULLS FIRST LIMIT 50",
    )
  ).rows;
  for (const post of posts) {
    try {
      demand(
        /^\d+$/.test(post.external_post_id),
        "INVALID_POST_ID",
        "ID X inválido",
      );
      demand(
        post.secret_ref.startsWith(
          `dim/${post.organization_id}/${post.account_id}/`,
        ),
        "VAULT_SCOPE",
        "Referência inválida",
      );
      const secret = await vault.get(post.secret_ref);
      const response = await request(
        `https://api.x.com/2/tweets/${post.external_post_id}?tweet.fields=public_metrics,author_id`,
        {
          headers: { Authorization: `Bearer ${secret.token}` },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      demand(response.ok, "METRICS_UNAVAILABLE", "Métricas indisponíveis");
      const result = await response.json();
      demand(
        String(result.data?.author_id) === post.external_id &&
          String(result.data?.id) === post.external_post_id,
        "POST_OWNER_MISMATCH",
        "Post de outra conta",
      );
      const metrics = Object.entries(result.data?.public_metrics || {}).filter(
        ([code, value]) =>
          /^[a-z_]+$/.test(code) &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0,
      );
      demand(metrics.length, "NO_METRICS", "Métricas não fornecidas");
      await db.transaction(async (tx) => {
        for (const [code, value] of metrics)
          await insert(tx, "publication_metrics", {
            organization_id: post.organization_id,
            published_post_id: post.id,
            metric_code: code,
            metric_value: value,
            observed_at: new Date().toISOString(),
            provenance: "x_api_v2_public_metrics",
          });
        await tx.query(
          "UPDATE custom_dim.published_posts SET metrics_attempted_at=now(),metrics_status='available' WHERE id=$1",
          [post.id],
        );
      });
    } catch {
      await db.query(
        "UPDATE custom_dim.published_posts SET metrics_attempted_at=now(),metrics_status='unavailable' WHERE id=$1",
        [post.id],
      );
    }
  }
  return { attempted: posts.length };
}
