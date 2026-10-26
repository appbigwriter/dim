import { channelMetrics } from "../../connectors/src/channels-metrics";
import type { Vault } from "../../connectors/src/index";
import { demand } from "../../contracts/src/index";
import { insert, one, type Database } from "../../db/src/index";
export async function collectAdditionalMetrics(
  db: Database,
  vault: Vault,
  fetcher: typeof fetch = fetch,
) {
  const posts = (
    await db.query(
      `SELECT p.*,a.id AS account_id,a.external_id,a.organization_id,i.id AS integration_id,i.secret_ref,i.granted_scopes,platform.code AS provider FROM custom_dim.published_posts p JOIN custom_dim.publication_jobs j ON j.id=p.job_id JOIN custom_dim.social_accounts a ON a.id=j.social_account_id JOIN custom_dim.platforms platform ON platform.id=a.platform_id JOIN custom_dim.account_integrations i ON i.social_account_id=a.id AND i.status='active' WHERE p.state='published' AND platform.code IN('facebook','instagram','youtube','cms') AND a.account_status='active' AND (i.expires_at IS NULL OR i.expires_at>now()) AND (p.metrics_attempted_at IS NULL OR p.metrics_attempted_at<now()-interval '15 minutes') ORDER BY p.metrics_attempted_at NULLS FIRST LIMIT 50`,
    )
  ).rows;
  for (const post of posts) {
    try {
      demand(
        post.secret_ref.startsWith(
          `dim/${post.organization_id}/${post.account_id}/`,
        ),
        "METRICS_VAULT_SCOPE",
        "Referência de credencial fora do escopo",
        409,
      );
      const metrics = await channelMetrics(
        post.provider,
        post.external_id,
        post.external_post_id,
        await vault.get(post.secret_ref),
        post.granted_scopes,
        fetcher,
      );
      const observedAt = new Date().toISOString();
      await db.transaction(async (tx) => {
        const current = await one(
          tx,
          "SELECT i.id FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id WHERE i.id=$1 AND i.status='active' AND i.secret_ref=$2 AND a.account_status='active' AND a.external_id=$3 AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp()) FOR SHARE OF i,a",
          [post.integration_id, post.secret_ref, post.external_id],
        );
        if (!current) return;
        for (const metric of metrics)
          await insert(tx, "publication_metrics", {
            organization_id: post.organization_id,
            published_post_id: post.id,
            metric_code: metric.code,
            metric_value: metric.value,
            provenance: metric.provenance,
            observed_at: observedAt,
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
