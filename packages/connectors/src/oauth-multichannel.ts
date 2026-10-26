import { createHash } from "node:crypto";
import { demand } from "../../contracts/src/index";
export type OAuthProvider = "x" | "meta" | "google";
export type OAuthClient = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  graphVersion?: string;
  mediaAllowedOrigins?: string[];
  allowNonprivate?: boolean;
};
export type OAuthProvidersConfig = Partial<Record<OAuthProvider, OAuthClient>>;
export function oauthConfigFromEnvironment(
  env: Record<string, string | undefined> = process.env,
): OAuthProvidersConfig {
  const config: OAuthProvidersConfig = {};
  for (const [provider, prefix] of [
    ["x", "X"],
    ["meta", "META"],
    ["google", "GOOGLE"],
  ] as const) {
    if (!env[`${prefix}_CLIENT_ID`] || !env[`${prefix}_CONNECT_REDIRECT_URI`])
      continue;
    config[provider] = {
      clientId: env[`${prefix}_CLIENT_ID`]!,
      clientSecret: env[`${prefix}_CLIENT_SECRET`],
      redirectUri: env[`${prefix}_CONNECT_REDIRECT_URI`]!,
      ...(provider === "meta" ? { graphVersion: env.META_GRAPH_VERSION } : {}),
    };
  }
  if (env.OAUTH_MEDIA_ALLOWED_ORIGINS && config.meta) {
    let origins: unknown;
    try {
      origins = JSON.parse(env.OAUTH_MEDIA_ALLOWED_ORIGINS);
    } catch {
      origins = null;
    }
    demand(
      Array.isArray(origins) &&
        origins.every((origin) => {
          if (typeof origin !== "string") return false;
          try {
            const parsed = new URL(origin);
            return parsed.protocol === "https:" && parsed.origin === origin;
          } catch {
            return false;
          }
        }),
      "OAUTH_MEDIA_ALLOWLIST",
      "Allowlist de mídia OAuth deve conter origins HTTPS",
      503,
    );
    config.meta.mediaAllowedOrigins = origins;
  }
  if (config.google)
    config.google.allowNonprivate = env.YOUTUBE_ALLOW_NONPRIVATE === "true";
  return config;
}
export type OAuthChoice = {
  id: string;
  label: string;
  channel: "x" | "facebook" | "instagram" | "youtube";
  secret: Record<string, string>;
  scopes: string[];
  expiresAt: string | null;
};
export type OAuthGrant = { choices: OAuthChoice[] };
const youtubeScopes = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];
export function oauthClient(
  config: OAuthProvidersConfig,
  provider: OAuthProvider,
) {
  const client = config[provider];
  demand(
    client?.clientId &&
      client.redirectUri &&
      (provider === "x" || client.clientSecret),
    "OAUTH_NOT_CONFIGURED",
    "Configure o aplicativo OAuth deste provedor",
    503,
  );
  const uri = new URL(client.redirectUri);
  demand(
    !uri.username &&
      !uri.password &&
      !uri.hash &&
      !uri.search &&
      (uri.protocol === "https:" ||
        (process.env.APP_ENV === "development" &&
          uri.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(uri.hostname))),
    "OAUTH_CALLBACK_INVALID",
    "Callback deve usar HTTPS e configuração explícita",
    503,
  );
  if (provider === "meta")
    demand(
      /^v\d+\.\d+$/.test(client.graphVersion || ""),
      "OAUTH_GRAPH_VERSION",
      "Configure versão Graph aprovada",
      503,
    );
  return client;
}
export function oauthAuthorize(
  provider: OAuthProvider,
  client: OAuthClient,
  state: string,
  verifier: string,
) {
  const url = new URL(
    provider === "x"
      ? "https://x.com/i/oauth2/authorize"
      : provider === "google"
        ? "https://accounts.google.com/o/oauth2/v2/auth"
        : `https://www.facebook.com/${client.graphVersion}/dialog/oauth`,
  );
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    state,
    scope:
      provider === "x"
        ? "tweet.read tweet.write users.read offline.access"
        : provider === "google"
          ? youtubeScopes.join(" ")
          : "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
    ...(provider !== "meta"
      ? {
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
        }
      : {}),
    ...(provider === "google"
      ? { access_type: "offline", prompt: "consent" }
      : {}),
  }).toString();
  return url.href;
}
async function json(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
) {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    demand(false, "OAUTH_UNAVAILABLE", "Provedor OAuth indisponível", 503);
  }
  demand(
    response.ok,
    response.status === 401 || response.status === 403
      ? "OAUTH_REAUTH_REQUIRED"
      : "OAUTH_PROVIDER_FAILED",
    "Provedor não confirmou autorização",
    response.status >= 500 || response.status === 429 ? 503 : 409,
  );
  const reader = response.body?.getReader();
  demand(reader, "OAUTH_RESPONSE_INVALID", "Resposta OAuth ausente", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      demand(
        size <= 1048576,
        "OAUTH_RESPONSE_INVALID",
        "Resposta OAuth excede limite",
        502,
      );
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    demand(false, "OAUTH_RESPONSE_INVALID", "Resposta OAuth inválida", 502);
  }
}
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
function expiration(seconds: unknown) {
  demand(
    Number.isFinite(Number(seconds)) && Number(seconds) > 0,
    "OAUTH_EXPIRY_REQUIRED",
    "Validade da autorização não confirmada",
    502,
  );
  return new Date(Date.now() + Number(seconds) * 1000).toISOString();
}
function scopes(value: unknown) {
  demand(
    typeof value === "string" && value.length > 0,
    "OAUTH_SCOPES_REQUIRED",
    "Permissões não confirmadas pelo provedor",
    409,
  );
  return value.split(" ").filter(Boolean);
}
async function tokenRequest(
  provider: "x" | "google",
  client: OAuthClient,
  body: Record<string, string>,
  fetcher: typeof fetch,
) {
  return json(
    fetcher,
    provider === "x"
      ? "https://api.x.com/2/oauth2/token"
      : "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(provider === "x" && client.clientSecret
          ? {
              Authorization: `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`,
            }
          : {}),
      },
      body: new URLSearchParams({
        ...body,
        client_id: client.clientId,
        ...(provider === "google" && client.clientSecret
          ? { client_secret: client.clientSecret }
          : {}),
      }).toString(),
    },
  );
}
async function standardChoices(
  provider: "x" | "google",
  client: OAuthClient,
  token: any,
  fetcher: typeof fetch,
): Promise<OAuthChoice[]> {
  demand(
    typeof token.access_token === "string" && token.access_token,
    "OAUTH_TOKEN_REQUIRED",
    "Token não confirmado",
    502,
  );
  const granted = scopes(token.scope),
    expiresAt = expiration(token.expires_in);
  const required =
    provider === "x"
      ? ["tweet.read", "tweet.write", "users.read"]
      : youtubeScopes;
  demand(
    required.every((scope) => granted.includes(scope)),
    "OAUTH_SCOPES_REQUIRED",
    "Permissões obrigatórias não concedidas",
    409,
  );
  const secret = {
    token: token.access_token,
    provider,
    client_id: client.clientId,
    ...(provider === "google"
      ? { allow_nonprivate: client.allowNonprivate ? "true" : "false" }
      : {}),
    ...(token.refresh_token
      ? { refresh_token: String(token.refresh_token) }
      : {}),
  };
  if (provider === "x") {
    const profile = (
      await json(fetcher, "https://api.x.com/2/users/me", {
        headers: bearer(token.access_token),
      })
    ).data;
    demand(
      /^\d+$/.test(String(profile?.id || "")),
      "OAUTH_OWNER_REQUIRED",
      "Titular da conta não confirmado",
      409,
    );
    return [
      {
        id: String(profile.id),
        label: String(profile.username || profile.id),
        channel: "x",
        secret,
        scopes: granted,
        expiresAt,
      },
    ];
  }
  const result = await json(
    fetcher,
    "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true&maxResults=50",
    { headers: bearer(token.access_token) },
  );
  demand(
    Array.isArray(result.items) &&
      result.items.length > 0 &&
      !result.nextPageToken,
    "OAUTH_CHANNEL_REQUIRED",
    "Canal YouTube autorizado não confirmado",
    409,
  );
  return result.items.map((channel: any) => {
    demand(
      typeof channel.id === "string" &&
        /^UC[A-Za-z0-9_-]{22}$/.test(channel.id),
      "OAUTH_OWNER_REQUIRED",
      "Canal inválido",
      409,
    );
    return {
      id: channel.id,
      label: String(channel.snippet?.title || channel.id).slice(0, 200),
      channel: "youtube",
      secret,
      scopes: granted,
      expiresAt,
    };
  });
}
async function metaChoices(
  client: OAuthClient,
  userToken: string,
  userExpiresAt: string,
  fetcher: typeof fetch,
): Promise<OAuthChoice[]> {
  const base = `https://graph.facebook.com/${client.graphVersion}`;
  const permissions = await json(fetcher, `${base}/me/permissions`, {
    headers: bearer(userToken),
  });
  demand(
    Array.isArray(permissions.data),
    "OAUTH_SCOPES_REQUIRED",
    "Permissões Meta ausentes",
    409,
  );
  const granted: string[] = permissions.data
    .filter((p: any) => p.status === "granted")
    .map((p: any) => String(p.permission));
  demand(
    ["pages_show_list", "pages_read_engagement"].every((scope) =>
      granted.includes(scope),
    ),
    "OAUTH_SCOPES_REQUIRED",
    "Permissões de Páginas necessárias",
    409,
  );
  const choices: OAuthChoice[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${base}/me/accounts`);
    url.searchParams.set(
      "fields",
      "id,name,access_token,tasks,instagram_business_account{id,username}",
    );
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("after", cursor);
    const result = await json(fetcher, url.href, {
      headers: bearer(userToken),
    });
    demand(
      Array.isArray(result.data),
      "OAUTH_OWNER_REQUIRED",
      "Páginas autorizadas não confirmadas",
      409,
    );
    for (const page of result.data) {
      if (
        !/^\d+$/.test(String(page.id)) ||
        !page.access_token ||
        !Array.isArray(page.tasks) ||
        !page.tasks.some((task: string) =>
          [
            "CREATE_CONTENT",
            "MANAGE",
            "PROFILE_PLUS_CREATE_CONTENT",
            "PROFILE_PLUS_FULL_CONTROL",
          ].includes(task),
        )
      )
        continue;
      const secret = {
        token: String(page.access_token),
        provider: "meta",
        user_token: userToken,
        user_expires_at: userExpiresAt,
        graph_version: client.graphVersion!,
        app_id: client.clientId,
        app_access_token: `${client.clientId}|${client.clientSecret}`,
        page_id: String(page.id),
        ...(client.mediaAllowedOrigins
          ? {
              media_allowed_origins: JSON.stringify(client.mediaAllowedOrigins),
            }
          : {}),
      };
      if (granted.includes("pages_manage_posts"))
        choices.push({
          id: String(page.id),
          label: String(page.name || page.id).slice(0, 200),
          channel: "facebook",
          secret,
          scopes: granted,
          expiresAt: userExpiresAt,
        });
      const ig = page.instagram_business_account;
      if (
        ig &&
        /^\d+$/.test(String(ig.id)) &&
        ["instagram_basic", "instagram_content_publish"].every((scope) =>
          granted.includes(scope),
        )
      )
        choices.push({
          id: String(ig.id),
          label: String(ig.username || ig.id).slice(0, 200),
          channel: "instagram",
          secret,
          scopes: granted,
          expiresAt: userExpiresAt,
        });
    }
    if (!result.paging?.next) break;
    demand(
      page < 9 &&
        typeof result.paging.cursors?.after === "string" &&
        result.paging.cursors.after !== cursor,
      "OAUTH_PAGINATION_LIMIT",
      "Seleção de Páginas excede limite seguro",
      409,
    );
    cursor = result.paging.cursors.after;
  }
  demand(
    choices.length > 0,
    "OAUTH_OWNER_REQUIRED",
    "Nenhuma Página ou conta profissional com autorização de criação",
    409,
  );
  return choices;
}
export async function exchangeOAuth(
  provider: OAuthProvider,
  client: OAuthClient,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthGrant> {
  if (provider !== "meta") {
    const token = await tokenRequest(
      provider,
      client,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: client.redirectUri,
        code_verifier: verifier,
      },
      fetcher,
    );
    return { choices: await standardChoices(provider, client, token, fetcher) };
  }
  const base = `https://graph.facebook.com/${client.graphVersion}/oauth/access_token`;
  const first = new URL(base);
  first.search = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret!,
    redirect_uri: client.redirectUri,
    code,
  }).toString();
  const short = await json(fetcher, first.href);
  demand(
    typeof short.access_token === "string",
    "OAUTH_TOKEN_REQUIRED",
    "Token Meta ausente",
    502,
  );
  const long = new URL(base);
  long.search = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: client.clientId,
    client_secret: client.clientSecret!,
    fb_exchange_token: short.access_token,
  }).toString();
  const token = await json(fetcher, long.href);
  demand(
    typeof token.access_token === "string",
    "OAUTH_TOKEN_REQUIRED",
    "Token Meta de longa duração ausente",
    502,
  );
  return {
    choices: await metaChoices(
      client,
      token.access_token,
      expiration(token.expires_in),
      fetcher,
    ),
  };
}
export async function renewOAuth(
  provider: OAuthProvider,
  client: OAuthClient,
  current: Record<string, string>,
  destination: string,
  channel: string,
  oldScopes: string[],
  fetcher: typeof fetch = fetch,
): Promise<OAuthChoice> {
  let choices: OAuthChoice[];
  if (provider === "meta") {
    demand(
      current.user_token &&
        new Date(current.user_expires_at).getTime() > Date.now() + 15 * 60000,
      "OAUTH_REAUTH_REQUIRED",
      "Renove a autorização Meta com o titular",
      409,
    );
    choices = await metaChoices(
      client,
      current.user_token,
      current.user_expires_at,
      fetcher,
    );
  } else {
    demand(
      current.refresh_token,
      "OAUTH_REAUTH_REQUIRED",
      "Autorize acesso offline novamente",
      409,
    );
    const token = await tokenRequest(
      provider,
      client,
      { grant_type: "refresh_token", refresh_token: current.refresh_token },
      fetcher,
    );
    choices = await standardChoices(
      provider,
      client,
      {
        ...token,
        scope: token.scope || oldScopes.join(" "),
        refresh_token: token.refresh_token || current.refresh_token,
      },
      fetcher,
    );
  }
  const choice = choices.find(
    (option) => option.id === destination && option.channel === channel,
  );
  demand(
    choice,
    "OAUTH_OWNER_MISMATCH",
    "Renovação não pertence à conta vinculada",
    409,
  );
  return { ...choice, secret: { ...current, ...choice.secret } };
}
