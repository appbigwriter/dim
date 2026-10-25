import { timingSafeEqual, createHmac } from "node:crypto";
import { AppError, demand } from "../../contracts/src/index";
export interface Vault {
  get(ref: string): Promise<Record<string, string>>;
  put(ref: string, data: Record<string, string>): Promise<void>;
}
export class HashicorpVault implements Vault {
  constructor(
    private address: string,
    private token: string,
    private mount = "secret",
  ) {
    demand(
      new URL(address).protocol === "https:" ||
        process.env.APP_ENV === "development",
      "VAULT_TLS",
      "Vault exige TLS",
    );
  }
  private async request(ref: string, method: string, data?: any) {
    demand(
      /^[a-zA-Z0-9/_-]+$/.test(ref) && !ref.includes(".."),
      "VAULT_REF",
      "Referência de cofre inválida",
    );
    const response = await fetch(
      `${this.address}/v1/${this.mount}/data/${ref}`,
      {
        method,
        headers: {
          "X-Vault-Token": this.token,
          "Content-Type": "application/json",
        },
        body: data ? JSON.stringify({ data }) : undefined,
        signal: AbortSignal.timeout(8000),
      },
    );
    demand(response.ok, "VAULT_UNAVAILABLE", "Cofre indisponível", 503);
    return method === "GET" ? (await response.json()).data.data : undefined;
  }
  async get(ref: string) {
    return this.request(ref, "GET");
  }
  async put(ref: string, data: Record<string, string>) {
    await this.request(ref, "POST", data);
  }
}
export class ProviderFailure extends Error {
  constructor(
    public kind: "retry" | "permanent" | "uncertain",
    public code: string,
    public retryAfter = 0,
  ) {
    super(code);
  }
}
export type PublishResult = { externalId: string; url?: string };
export interface Connector {
  publish(input: {
    token: string;
    destination: string;
    text: string;
    idempotencyKey: string;
  }): Promise<PublishResult>;
  health(
    token: string,
    destination: string,
  ): Promise<{
    publish: boolean;
    readMessages: boolean;
    sendMessages: boolean;
  }>;
}
const circuits = new Map<string, { failures: number; until: number }>();
export async function providerRequest(
  url: string,
  token: string,
  body: any,
): Promise<any> {
  const host = new URL(url).host;
  const circuit = circuits.get(host);
  if (circuit && circuit.until > Date.now())
    throw new ProviderFailure("retry", "CIRCUIT_OPEN", 30);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
  } catch {
    throw new ProviderFailure("uncertain", "PROVIDER_TIMEOUT");
  }
  if (response.status === 429)
    throw new ProviderFailure(
      "retry",
      "RATE_LIMIT",
      Number(response.headers.get("retry-after") || 30),
    );
  if (response.status >= 500) {
    const failures = (circuit?.failures || 0) + 1;
    circuits.set(host, {
      failures,
      until: failures >= 3 ? Date.now() + 30000 : 0,
    });
    throw new ProviderFailure("uncertain", "PROVIDER_5XX");
  }
  if (!response.ok)
    throw new ProviderFailure(
      "permanent",
      response.status === 401 || response.status === 403
        ? "AUTH_REVOKED"
        : "PROVIDER_REJECTED",
    );
  circuits.delete(host);
  return response.json();
}
export class TelegramConnector implements Connector {
  private url(token: string, method: string) {
    demand(
      /^\d+:[A-Za-z0-9_-]+$/.test(token),
      "INVALID_BOT_TOKEN",
      "Token de bot inválido",
    );
    return `https://api.telegram.org/bot${token}/${method}`;
  }
  async publish(input: {
    token: string;
    destination: string;
    text: string;
    idempotencyKey: string;
  }) {
    const result = await providerRequest(
      this.url(input.token, "sendMessage"),
      "",
      { chat_id: input.destination, text: input.text },
    );
    if (!result.ok) throw new ProviderFailure("permanent", "TELEGRAM_REJECTED");
    return { externalId: String(result.result.message_id) };
  }
  async health(token: string, destination: string) {
    const me = await providerRequest(this.url(token, "getMe"), "", {});
    demand(me.ok, "TOKEN_INVALID", "Bot não autorizado");
    const membership = await providerRequest(
      this.url(token, "getChatMember"),
      "",
      { chat_id: destination, user_id: me.result.id },
    );
    const status = membership.result?.status;
    return {
      publish:
        status === "creator" ||
        (status === "administrator" &&
          membership.result.can_post_messages === true),
      readMessages: status === "administrator" || status === "creator",
      sendMessages:
        status === "administrator" ||
        status === "creator" ||
        status === "member",
    };
  }
}
export class XConnector implements Connector {
  async publish(input: {
    token: string;
    destination: string;
    text: string;
    idempotencyKey: string;
  }) {
    const result = await providerRequest(
      "https://api.x.com/2/tweets",
      input.token,
      { text: input.text },
    );
    demand(result.data?.id, "PROVIDER_RESPONSE", "ID externo ausente", 502);
    return {
      externalId: String(result.data.id),
      url: `https://x.com/i/status/${result.data.id}`,
    };
  }
  async health(token: string, destination: string) {
    const result = await fetch("https://api.x.com/2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    demand(result.ok, "AUTH_REVOKED", "Conta X não autorizada");
    const data = await result.json();
    demand(
      String(data.data?.id) === destination,
      "ACCOUNT_OWNER_MISMATCH",
      "Titular da conta difere da integração",
    );
    return { publish: false, readMessages: false, sendMessages: false };
  }
}
export async function whatsappSend(
  token: string,
  phoneId: string,
  to: string,
  payload: {
    text?: string;
    template?: { name: string; language: { code: string } };
  },
) {
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  demand(
    version && /^v\d+\.\d+$/.test(version),
    "PROVIDER_NOT_CONFIGURED",
    "Versão Graph aprovada deve ser configurada",
    503,
  );
  demand(
    /^\d+$/.test(phoneId) && /^\d+$/.test(to),
    "INVALID_DESTINATION",
    "Destino inválido",
  );
  return providerRequest(
    `https://graph.facebook.com/${version}/${phoneId}/messages`,
    token,
    {
      messaging_product: "whatsapp",
      to,
      type: payload.template ? "template" : "text",
      ...(payload.template
        ? { template: payload.template }
        : { text: { body: payload.text } }),
    },
  );
}
export async function whatsappHealth(
  token: string,
  phoneId: string,
  appAccessToken: string,
) {
  demand(
    token && appAccessToken,
    "WHATSAPP_SECRET_REQUIRED",
    "Configure token e app_access_token no cofre",
    503,
  );
  const version = process.env.WHATSAPP_GRAPH_VERSION;
  demand(
    version && /^v\d+\.\d+$/.test(version),
    "PROVIDER_NOT_CONFIGURED",
    "Configure versão Graph aprovada",
    503,
  );
  demand(
    /^\d+$/.test(phoneId),
    "INVALID_DESTINATION",
    "ID de telefone inválido",
  );
  const debug = await fetch(
    `https://graph.facebook.com/${version}/debug_token?input_token=${encodeURIComponent(token)}`,
    {
      headers: { Authorization: `Bearer ${appAccessToken}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  demand(debug.ok, "AUTH_REVOKED", "Autorização WhatsApp inválida");
  const grant = (await debug.json()).data;
  demand(
    grant?.is_valid && grant.scopes?.includes("whatsapp_business_messaging"),
    "SCOPE_REQUIRED",
    "Permissão whatsapp_business_messaging necessária",
  );
  const phone = await fetch(
    `https://graph.facebook.com/${version}/${phoneId}?fields=id,verified_name`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    },
  );
  demand(phone.ok, "PHONE_UNAUTHORIZED", "Número não autorizado");
  const info = await phone.json();
  demand(
    String(info.id) === phoneId,
    "PHONE_MISMATCH",
    "Número difere da autorização",
  );
  return {
    publish: false,
    readMessages: true,
    sendMessages: true,
    scopes: grant.scopes as string[],
    expiresAt: grant.expires_at
      ? new Date(grant.expires_at * 1000).toISOString()
      : undefined,
  };
}
export function sameSecret(a: string, b: string) {
  return (
    !!a &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function verifyWebhook(
  provider: string,
  raw: Buffer,
  headers: Record<string, any>,
  secrets: { telegram?: string; whatsapp?: string },
) {
  if (provider === "telegram")
    demand(
      sameSecret(
        String(headers["x-telegram-bot-api-secret-token"] || ""),
        secrets.telegram || "",
      ),
      "INVALID_SIGNATURE",
      "Assinatura inválida",
      401,
    );
  else if (provider === "whatsapp") {
    demand(
      secrets.whatsapp,
      "WEBHOOK_DISABLED",
      "Webhook não configurado",
      503,
    );
    demand(
      sameSecret(
        String(headers["x-hub-signature-256"] || ""),
        `sha256=${createHmac("sha256", secrets.whatsapp).update(raw).digest("hex")}`,
      ),
      "INVALID_SIGNATURE",
      "Assinatura inválida",
      401,
    );
  } else
    throw new AppError(404, "PROVIDER_NOT_FOUND", "Provedor não suportado");
}
