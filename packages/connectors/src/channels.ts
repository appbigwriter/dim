import { isIP } from "node:net";
import { demand } from "../../contracts/src/index";
import { type Connector, type PublishResult, ProviderFailure } from "./index";

export type ChannelPayload = {
  mediaAssetIds?: string[];
  title?: string;
  subject?: string;
  body?: Record<string, unknown>;
};
export type MediaResolver = (assetId: string) => Promise<{
  bytes: Buffer;
  mime: string;
  publicUrl?: string;
}>;
type Input = Parameters<Connector["publish"]>[0] & { payload?: ChannelPayload };
type Secrets = Record<string, string>;
type Health = Awaited<ReturnType<Connector["health"]>>;
const healthy: Health = {
  publish: true,
  readMessages: false,
  sendMessages: false,
};
const disabled: Health = {
  publish: false,
  readMessages: false,
  sendMessages: false,
};

function requireValue(value: unknown, code: string): asserts value {
  demand(value, code, "Configuração ou capacidade do canal indisponível", 409);
}
function identifier(value: string) {
  requireValue(/^\d+$/.test(value), "INVALID_DESTINATION");
  return value;
}
function endpoint(raw: string, origins: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderFailure("permanent", "ENDPOINT_INVALID");
  }
  requireValue(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !isIP(url.hostname) &&
      !url.hostname.includes(":") &&
      url.hostname.includes(".") &&
      !/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) &&
      origins.includes(url.origin),
    "ENDPOINT_NOT_ALLOWED",
  );
  return url;
}
function originList(value: string | undefined): string[] {
  try {
    const values: unknown = JSON.parse(value || "[]");
    requireValue(
      Array.isArray(values) && values.every((v) => typeof v === "string"),
      "ORIGIN_ALLOWLIST_REQUIRED",
    );
    return values as string[];
  } catch {
    throw new ProviderFailure("permanent", "ORIGIN_ALLOWLIST_REQUIRED");
  }
}
async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  mutation: boolean,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ProviderFailure(
      mutation ? "uncertain" : "retry",
      "CHANNEL_NETWORK_FAILURE",
      30,
    );
  }
  if (response.status === 429)
    throw new ProviderFailure(
      "retry",
      "RATE_LIMIT",
      Math.min(
        3600,
        Math.max(1, Number(response.headers.get("retry-after")) || 30),
      ),
    );
  if (response.status >= 500)
    throw new ProviderFailure(
      mutation ? "uncertain" : "retry",
      "CHANNEL_5XX",
      30,
    );
  if (!response.ok)
    throw new ProviderFailure(
      "permanent",
      response.status === 401 || response.status === 403
        ? "AUTH_REVOKED"
        : "CHANNEL_REJECTED",
    );
  return response;
}
async function json(response: Response, mutation: boolean): Promise<any> {
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1024 * 1024) throw new Error("size");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderFailure(
      mutation ? "uncertain" : "retry",
      "CHANNEL_RESPONSE_INVALID",
      30,
    );
  }
}
async function read(fetcher: typeof fetch, url: string, token: string) {
  return json(
    await request(
      fetcher,
      url,
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    ),
    false,
  );
}
async function write(
  fetcher: typeof fetch,
  url: string,
  token: string,
  body: unknown,
  key?: string,
) {
  return json(
    await request(
      fetcher,
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: JSON.stringify(body),
      },
      true,
    ),
    true,
  );
}
function external(value: unknown): string {
  // A successful HTTP response without a usable receipt may already have caused publication.
  if (typeof value !== "string" || !value || value.length > 512)
    throw new ProviderFailure("uncertain", "CHANNEL_RECEIPT_MISSING");
  return value;
}

class MetaBase {
  protected base: string;
  constructor(
    protected config: Secrets,
    protected fetcher: typeof fetch = fetch,
  ) {
    requireValue(
      /^v\d+\.\d+$/.test(config.graph_version || ""),
      "GRAPH_VERSION_REQUIRED",
    );
    this.base = `https://graph.facebook.com/${config.graph_version}`;
  }
  protected async grant(token: string, scopes: string[]) {
    requireValue(this.config.app_access_token, "APP_TOKEN_REQUIRED");
    const grant = (
      await read(
        this.fetcher,
        `${this.base}/debug_token?input_token=${encodeURIComponent(token)}`,
        this.config.app_access_token,
      )
    ).data;
    requireValue(
      grant?.is_valid === true &&
        Array.isArray(grant.scopes) &&
        scopes.every((s) => grant.scopes.includes(s)) &&
        (!grant.expires_at || grant.expires_at * 1000 > Date.now()) &&
        (!grant.data_access_expires_at ||
          grant.data_access_expires_at * 1000 > Date.now()) &&
        (!this.config.app_id || grant.app_id === this.config.app_id),
      "SCOPE_REQUIRED",
    );
    const expiry = [grant.expires_at, grant.data_access_expires_at].filter(
      (value: unknown) => typeof value === "number" && value > 0,
    );
    return {
      scopes: grant.scopes as string[],
      ...(expiry.length
        ? { expiresAt: new Date(Math.min(...expiry) * 1000).toISOString() }
        : {}),
    };
  }
  protected async page(token: string, destination: string) {
    const me = await read(this.fetcher, `${this.base}/me?fields=id`, token);
    requireValue(
      String(me.id) === identifier(destination),
      "ACCOUNT_OWNER_MISMATCH",
    );
  }
}
export class FacebookConnector extends MetaBase implements Connector {
  async health(token: string, destination: string) {
    const grant = await this.grant(token, [
      "pages_manage_posts",
      "pages_read_engagement",
    ]);
    await this.page(token, destination);
    return { ...healthy, ...grant };
  }
  async publish(input: Input): Promise<PublishResult> {
    requireValue(
      input.text.length > 0 &&
        input.text.length <= 63206 &&
        !input.payload?.mediaAssetIds?.length,
      "FACEBOOK_TEXT_REQUIRED",
    );
    await this.health(input.token, input.destination);
    await input.beforeSend?.();
    const result = await write(
      this.fetcher,
      `${this.base}/${identifier(input.destination)}/feed`,
      input.token,
      { message: input.text },
    );
    const id = external(result.id);
    return {
      externalId: id,
      url: `https://www.facebook.com/${encodeURIComponent(id)}`,
    };
  }
}
export class InstagramConnector extends MetaBase implements Connector {
  constructor(
    config: Secrets,
    private resolve?: MediaResolver,
    fetcher: typeof fetch = fetch,
  ) {
    super(config, fetcher);
  }
  async health(token: string, destination: string) {
    const grant = await this.grant(token, [
      "instagram_basic",
      "instagram_content_publish",
      "pages_read_engagement",
    ]);
    await this.page(token, this.config.page_id);
    const page = await read(
      this.fetcher,
      `${this.base}/${identifier(this.config.page_id)}?fields=instagram_business_account`,
      token,
    );
    requireValue(
      String(page.instagram_business_account?.id) === identifier(destination),
      "ACCOUNT_OWNER_MISMATCH",
    );
    return (this.resolve || this.config.media_transport_ready === "true") &&
      originList(this.config.media_allowed_origins).length
      ? { ...healthy, ...grant }
      : { ...disabled, ...grant };
  }
  async publish(input: Input): Promise<PublishResult> {
    requireValue(
      this.resolve &&
        input.payload?.mediaAssetIds?.length === 1 &&
        input.text.length <= 2200,
      "INSTAGRAM_JPEG_REQUIRED",
    );
    const media = await this.resolve(input.payload.mediaAssetIds[0]);
    requireValue(
      media.mime === "image/jpeg" &&
        media.bytes.length > 0 &&
        media.bytes.length <= 8 * 1024 * 1024 &&
        media.bytes[0] === 0xff &&
        media.bytes[1] === 0xd8 &&
        media.publicUrl,
      "INSTAGRAM_JPEG_REQUIRED",
    );
    const imageUrl = endpoint(
      media.publicUrl,
      originList(this.config.media_allowed_origins),
    );
    requireValue(
      (await this.health(input.token, input.destination)).publish,
      "MEDIA_TRANSPORT_REQUIRED",
    );
    await input.beforeSend?.();
    const container = await write(
      this.fetcher,
      `${this.base}/${identifier(input.destination)}/media`,
      input.token,
      { image_url: imageUrl.href, caption: input.text },
    );
    const containerId = external(container.id);
    // A container that is not finished is left for operator reconciliation, never recreated blindly.
    const state = await read(
      this.fetcher,
      `${this.base}/${identifier(containerId)}?fields=status_code`,
      input.token,
    );
    if (state.status_code !== "FINISHED")
      throw new ProviderFailure("uncertain", "INSTAGRAM_CONTAINER_PENDING");
    await input.beforeSend?.();
    const published = await write(
      this.fetcher,
      `${this.base}/${input.destination}/media_publish`,
      input.token,
      { creation_id: containerId },
    );
    return { externalId: external(published.id) };
  }
}

export class YouTubeConnector implements Connector {
  constructor(
    private config: Secrets,
    private resolve?: MediaResolver,
    private fetcher: typeof fetch = fetch,
  ) {}
  async health(token: string, destination: string) {
    const grant = await json(
      await request(
        this.fetcher,
        "https://oauth2.googleapis.com/tokeninfo",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ access_token: token }).toString(),
        },
        false,
      ),
      false,
    );
    const scopes = String(grant.scope || "").split(" ");
    requireValue(
      scopes.some((s) =>
        [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube",
          "https://www.googleapis.com/auth/youtube.force-ssl",
        ].includes(s),
      ) &&
        scopes.some((s) =>
          [
            "https://www.googleapis.com/auth/youtube.readonly",
            "https://www.googleapis.com/auth/youtube",
            "https://www.googleapis.com/auth/youtube.force-ssl",
          ].includes(s),
        ) &&
        Number(grant.expires_in) > 0 &&
        this.config.client_id &&
        grant.aud === this.config.client_id,
      "SCOPE_REQUIRED",
    );
    const channels = await read(
      this.fetcher,
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50",
      token,
    );
    requireValue(
      Array.isArray(channels.items) &&
        channels.items.some((c: any) => c.id === destination),
      "ACCOUNT_OWNER_MISMATCH",
    );
    return {
      ...(this.resolve || this.config.media_transport_ready === "true"
        ? healthy
        : disabled),
      scopes,
      expiresAt: new Date(
        Date.now() + Number(grant.expires_in) * 1000,
      ).toISOString(),
    };
  }
  async publish(input: Input): Promise<PublishResult> {
    requireValue(
      this.resolve &&
        input.payload?.mediaAssetIds?.length === 1 &&
        input.payload.title &&
        input.payload.title.length <= 100 &&
        input.text.length <= 5000,
      "YOUTUBE_VIDEO_REQUIRED",
    );
    const media = await this.resolve(input.payload.mediaAssetIds[0]);
    requireValue(
      media.mime === "video/mp4" &&
        media.bytes.length >= 12 &&
        media.bytes.length <= 100 * 1024 * 1024 &&
        media.bytes.subarray(4, 8).toString() === "ftyp",
      "YOUTUBE_VIDEO_REQUIRED",
    );
    requireValue(
      (await this.health(input.token, input.destination)).publish,
      "MEDIA_TRANSPORT_REQUIRED",
    );
    const privacy = input.payload.body?.privacyStatus || "private";
    requireValue(
      ["private", "unlisted", "public"].includes(String(privacy)) &&
        (privacy === "private" || this.config.allow_nonprivate === "true"),
      "YOUTUBE_PRIVACY_NOT_APPROVED",
    );
    requireValue(
      typeof input.payload.body?.madeForKids === "boolean",
      "YOUTUBE_AUDIENCE_DECLARATION_REQUIRED",
    );
    await input.beforeSend?.();
    const session = await request(
      this.fetcher,
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.token}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": media.mime,
          "X-Upload-Content-Length": String(media.bytes.length),
        },
        body: JSON.stringify({
          snippet: { title: input.payload.title, description: input.text },
          status: {
            privacyStatus: privacy,
            selfDeclaredMadeForKids: input.payload.body.madeForKids,
          },
        }),
      },
      true,
    );
    const location = session.headers.get("location");
    if (!location)
      throw new ProviderFailure("uncertain", "UPLOAD_SESSION_MISSING");
    const upload = endpoint(location, ["https://www.googleapis.com"]);
    if (upload.pathname !== "/upload/youtube/v3/videos")
      throw new ProviderFailure("uncertain", "UPLOAD_SESSION_INVALID");
    await input.beforeSend?.();
    const result = await json(
      await request(
        this.fetcher,
        upload.href,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${input.token}`,
            "Content-Type": media.mime,
            "Content-Length": String(media.bytes.length),
          },
          body: new Uint8Array(media.bytes),
        },
        true,
      ),
      true,
    );
    const id = external(result.id);
    return {
      externalId: id,
      url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
    };
  }
}

export type ApprovedRecipientResolver = (
  idempotencyKey: string,
) => Promise<{ email: string; consentReceiptId: string }>;
// This is a configurable private gateway protocol, not a fabricated email vendor API.
export class DelegatedChannelConnector implements Connector {
  constructor(
    private provider: "email" | "cms",
    private config: Secrets,
    private fetcher: typeof fetch = fetch,
    private recipient?: ApprovedRecipientResolver,
  ) {}
  private configured(name: string) {
    return endpoint(this.config[name], originList(this.config.allowed_origins))
      .href;
  }
  async health(token: string, destination: string) {
    const status = await read(
      this.fetcher,
      this.configured("health_url"),
      token,
    );
    requireValue(
      status.contractId === "dim.channel-transport.v1" &&
        status.provider === this.provider &&
        status.destination === destination &&
        status.readbackVerified === true &&
        status.capabilities?.includes("publish_text") &&
        (this.provider !== "cms" || status.owner === "audience-builder") &&
        (this.provider !== "email" || status.senderVerified === true),
      "CHANNEL_HEALTH_UNVERIFIED",
    );
    return this.provider === "email" && !this.recipient ? disabled : healthy;
  }
  async publish(input: Input): Promise<PublishResult> {
    requireValue(
      input.text.length > 0 &&
        input.text.length <= 100000 &&
        !input.payload?.mediaAssetIds?.length,
      "TEXT_REQUIRED",
    );
    requireValue(
      (await this.health(input.token, input.destination)).publish,
      "CONSENT_RESOLVER_REQUIRED",
    );
    const actionId = input.payload?.body?.audience_action_id;
    const actionHash = input.payload?.body?.audience_action_hash;
    if (this.provider === "cms")
      requireValue(
        typeof actionId === "string" &&
          actionId.length > 0 &&
          actionId.length <= 180 &&
          typeof actionHash === "string" &&
          /^sha256:[a-f0-9]{64}$/.test(actionHash),
        "AUDIENCE_APPROVED_ACTION_REQUIRED",
      );
    let recipient;
    if (this.provider === "email") {
      requireValue(
        this.recipient &&
          input.payload?.subject &&
          input.payload.subject.length <= 200 &&
          !/[\r\n]/.test(input.payload.subject),
        "EMAIL_SUBJECT_REQUIRED",
      );
      recipient = await this.recipient(input.idempotencyKey);
      requireValue(
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email) &&
          recipient.consentReceiptId,
        "EMAIL_CONSENT_REQUIRED",
      );
    }
    await input.beforeSend?.();
    const receipt = await write(
      this.fetcher,
      this.configured("publish_url"),
      input.token,
      {
        contractId: "dim.channel-transport.v1",
        provider: this.provider,
        destination: input.destination,
        idempotencyKey: input.idempotencyKey,
        text: input.text,
        subject: input.payload?.subject,
        title: input.payload?.title,
        recipient,
        ...(this.provider === "cms" ? { actionId, actionHash } : {}),
      },
      input.idempotencyKey,
    );
    if (
      receipt.contractId !== "dim.channel-transport.v1" ||
      receipt.idempotencyKey !== input.idempotencyKey ||
      receipt.destination !== input.destination ||
      (this.provider === "cms" &&
        (receipt.actionId !== actionId || receipt.actionHash !== actionHash)) ||
      receipt.status !== "published"
    )
      throw new ProviderFailure("uncertain", "CHANNEL_RECEIPT_UNVERIFIED");
    return { externalId: external(receipt.externalId) };
  }
}
export function channelConnector(
  provider: string,
  secret: Secrets,
  mediaResolver?: MediaResolver,
  fetcher: typeof fetch = fetch,
): Connector {
  if (provider === "facebook") return new FacebookConnector(secret, fetcher);
  if (provider === "instagram")
    return new InstagramConnector(secret, mediaResolver, fetcher);
  if (provider === "youtube")
    return new YouTubeConnector(secret, mediaResolver, fetcher);
  if (provider === "email" || provider === "cms")
    return new DelegatedChannelConnector(provider, secret, fetcher);
  throw new ProviderFailure("permanent", "CHANNEL_NOT_SUPPORTED");
}
export async function channelHealth(
  provider: string,
  secret: Secrets,
  destination: string,
  fetcher: typeof fetch = fetch,
) {
  return channelConnector(provider, secret, undefined, fetcher).health(
    secret.token,
    destination,
  );
}
export function channelCapabilityCode(provider: string) {
  if (provider === "instagram") return "publish_media";
  if (provider === "youtube") return "publish_video";
  if (provider === "cms") return "publish_article";
  if (provider === "email") return "send_email";
  return "publish_text";
}
