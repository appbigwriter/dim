import { isIP } from "node:net";
import { demand } from "../../contracts/src/index";
import { FacebookConnector, InstagramConnector } from "./channels";
export type ChannelMetric = { code: string; value: string; provenance: string };
async function get(url: string, token: string, fetcher: typeof fetch) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  demand(
    response.ok,
    "METRICS_UNAVAILABLE",
    "Provedor não disponibilizou métricas",
    503,
  );
  const reader = response.body?.getReader();
  demand(
    reader,
    "METRICS_RESPONSE_INVALID",
    "Resposta de métricas ausente",
    502,
  );
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      demand(
        bytes <= 1048576,
        "METRICS_RESPONSE_INVALID",
        "Resposta excede limite",
        502,
      );
      parts.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function count(
  code: string,
  value: unknown,
  provenance: string,
): ChannelMetric[] {
  const exact =
    typeof value === "string"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? String(value)
        : "";
  return /^(0|[1-9]\d{0,39})$/.test(exact)
    ? [{ code, value: exact, provenance }]
    : [];
}
export async function channelMetrics(
  provider: string,
  destination: string,
  postId: string,
  secret: Record<string, string>,
  grantedScopes: string[],
  fetcher: typeof fetch = fetch,
): Promise<ChannelMetric[]> {
  const metrics: ChannelMetric[] = [];
  if (provider === "youtube") {
    demand(
      /^UC[A-Za-z0-9_-]{22}$/.test(destination) &&
        /^[A-Za-z0-9_-]{1,100}$/.test(postId),
      "METRICS_ID_INVALID",
      "Identificador YouTube inválido",
      409,
    );
    const mine = await get(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50",
      secret.token,
      fetcher,
    );
    demand(
      mine.items?.some((channel: any) => channel.id === destination),
      "METRICS_OWNER_MISMATCH",
      "Canal não pertence à autorização",
      403,
    );
    const result = await get(
      `https://www.googleapis.com/youtube/v3/videos?part=id,snippet,statistics&id=${encodeURIComponent(postId)}`,
      secret.token,
      fetcher,
    );
    const video = result.items?.find((item: any) => item.id === postId);
    demand(
      video?.snippet?.channelId === destination,
      "METRICS_OWNER_MISMATCH",
      "Vídeo pertence a outro canal",
      403,
    );
    for (const [field, code] of [
      ["viewCount", "views"],
      ["likeCount", "likes"],
      ["commentCount", "comments"],
    ])
      metrics.push(
        ...count(code, video.statistics?.[field], "youtube_data_v3_statistics"),
      );
  } else if (provider === "facebook" || provider === "instagram") {
    demand(
      /^\d+$/.test(destination) &&
        /^[\d_]+$/.test(postId) &&
        /^v\d+\.\d+$/.test(secret.graph_version || ""),
      "METRICS_ID_INVALID",
      "Identificador Graph inválido",
      409,
    );
    const base = `https://graph.facebook.com/${secret.graph_version}`;
    if (provider === "facebook") {
      await new FacebookConnector(secret, fetcher).health(
        secret.token,
        destination,
      );
      const post = await get(
        `${base}/${postId}?fields=id,from,shares,comments.limit(0).summary(true),reactions.limit(0).summary(true)`,
        secret.token,
        fetcher,
      );
      demand(
        String(post.id) === postId && String(post.from?.id) === destination,
        "METRICS_OWNER_MISMATCH",
        "Publicação pertence a outra Página",
        403,
      );
      metrics.push(
        ...count("shares", post.shares?.count, "facebook_graph_post_summary"),
        ...count(
          "comments",
          post.comments?.summary?.total_count,
          "facebook_graph_post_summary",
        ),
        ...count(
          "reactions",
          post.reactions?.summary?.total_count,
          "facebook_graph_post_summary",
        ),
      );
    } else {
      await new InstagramConnector(secret, undefined, fetcher).health(
        secret.token,
        destination,
      );
      const post = await get(
        `${base}/${postId}?fields=id,owner,like_count,comments_count`,
        secret.token,
        fetcher,
      );
      demand(
        String(post.id) === postId && String(post.owner?.id) === destination,
        "METRICS_OWNER_MISMATCH",
        "Mídia pertence a outra conta Instagram",
        403,
      );
      metrics.push(
        ...count("likes", post.like_count, "instagram_graph_media_counts"),
        ...count(
          "comments",
          post.comments_count,
          "instagram_graph_media_counts",
        ),
      );
      if (grantedScopes.includes("instagram_manage_insights")) {
        const result = await get(
          `${base}/${postId}/insights?metric=reach`,
          secret.token,
          fetcher,
        );
        const reach = result.data?.find(
          (metric: any) => metric.name === "reach",
        );
        metrics.push(
          ...count(
            "reach",
            reach?.total_value?.value ??
              (reach?.values?.length === 1 ? reach.values[0].value : undefined),
            "instagram_graph_media_insights",
          ),
        );
      }
    }
  } else if (provider === "cms") {
    let allowed: unknown;
    try {
      allowed = JSON.parse(secret.allowed_origins || "[]");
    } catch {
      allowed = [];
    }
    demand(
      secret.metrics_url && Array.isArray(allowed),
      "METRICS_UNSUPPORTED",
      "Configure o adaptador de métricas do Audience",
      409,
    );
    const url = new URL(secret.metrics_url);
    demand(
      url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !isIP(url.hostname) &&
        url.hostname.includes(".") &&
        !/(^|\.)(local|localhost|internal)$/.test(url.hostname) &&
        allowed.includes(url.origin),
      "METRICS_URL_INVALID",
      "Endpoint de métricas fora da allowlist",
      409,
    );
    url.searchParams.set("destination", destination);
    url.searchParams.set("external_id", postId);
    const result = await get(url.href, secret.token, fetcher);
    demand(
      result.contractId === "dim.channel-metrics.v1" &&
        result.provider === "cms" &&
        result.owner === "audience-builder" &&
        result.destination === destination &&
        result.externalId === postId &&
        Array.isArray(result.metrics) &&
        result.metrics.length <= 20,
      "METRICS_OWNER_MISMATCH",
      "Métricas CMS sem confirmação de origem e titularidade",
      403,
    );
    for (const metric of result.metrics)
      if (["approved_comments", "views", "visitors"].includes(metric.code))
        metrics.push(
          ...count(metric.code, metric.value, "audience_cms_verified_metrics"),
        );
  } else
    demand(
      false,
      "METRICS_UNSUPPORTED",
      "Provedor não disponibiliza estas métricas por publicação",
      409,
    );
  demand(
    metrics.length > 0,
    "METRICS_UNAVAILABLE",
    "Nenhuma métrica confirmada pelo provedor",
    503,
  );
  return metrics;
}
