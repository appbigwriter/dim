import { z } from "zod";
import { demand } from "../../contracts/src/index";
import { ProviderFailure } from "./index";

export function emailAddress(value: string) {
  const parsed = z.email().max(254).safeParse(value);
  demand(
    parsed.success && !/[\r\n<>]/.test(value),
    "EMAIL_ADDRESS_INVALID",
    "Endereço de e-mail inválido",
  );
  const split = value.lastIndexOf("@");
  return value.slice(0, split) + "@" + value.slice(split + 1).toLowerCase();
}
export class ResendEmail {
  constructor(
    private config: Record<string, string>,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async call(
    path: string,
    method: "GET" | "POST",
    body?: unknown,
    key?: string,
  ) {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.resend.com${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ProviderFailure(
        method === "POST" ? "uncertain" : "retry",
        "EMAIL_NETWORK_FAILURE",
        30,
      );
    }
    if (response.status === 429)
      throw new ProviderFailure("retry", "EMAIL_RATE_LIMIT", 30);
    if (response.status >= 500)
      throw new ProviderFailure(
        method === "POST" ? "uncertain" : "retry",
        "EMAIL_PROVIDER_FAILURE",
        30,
      );
    if (!response.ok)
      throw new ProviderFailure(
        "permanent",
        response.status === 401 || response.status === 403
          ? "EMAIL_AUTH_REVOKED"
          : "EMAIL_REJECTED",
      );
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      if (!reader) throw new Error("empty");
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 1048576) throw new Error("size");
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ProviderFailure(
        method === "POST" ? "uncertain" : "retry",
        "EMAIL_RESPONSE_INVALID",
        30,
      );
    } finally {
      await reader?.cancel().catch(() => {});
    }
  }
  async health(destination: string) {
    demand(
      this.config.provider === "resend" &&
        this.config.token &&
        /^[a-f0-9-]{36}$/i.test(this.config.domain_id || ""),
      "EMAIL_NOT_CONFIGURED",
      "Configure domínio e credenciais Resend no cofre",
      503,
    );
    const sender = emailAddress(this.config.from_email || "");
    demand(
      sender === emailAddress(destination),
      "ACCOUNT_OWNER_MISMATCH",
      "Remetente diverge da conta vinculada",
      409,
    );
    const domain = await this.call(`/domains/${this.config.domain_id}`, "GET");
    demand(
      domain.id === this.config.domain_id &&
        domain.name?.toLowerCase() === sender.split("@")[1] &&
        domain.status === "verified" &&
        domain.capabilities?.sending === "enabled",
      "EMAIL_DOMAIN_UNVERIFIED",
      "Domínio remetente não está verificado para envio",
      409,
    );
    return { publish: false, readMessages: false, sendMessages: true };
  }
  async receivingHealth(destination: string) {
    demand(
      this.config.provider === "resend" &&
        this.config.token &&
        /^[a-f0-9-]{36}$/i.test(this.config.domain_id || ""),
      "EMAIL_NOT_CONFIGURED",
      "Configure domínio e credenciais Resend",
      503,
    );
    const sender = emailAddress(this.config.from_email || "");
    demand(
      sender === emailAddress(destination),
      "ACCOUNT_OWNER_MISMATCH",
      "Conta de e-mail diverge da autorização",
      409,
    );
    const domain = await this.call(`/domains/${this.config.domain_id}`, "GET");
    demand(
      domain.id === this.config.domain_id &&
        domain.name?.toLowerCase() === sender.split("@")[1] &&
        domain.status === "verified" &&
        domain.capabilities?.receiving === "enabled",
      "EMAIL_RECEIVING_UNVERIFIED",
      "Domínio não confirmado para recebimento",
      409,
    );
    return { readMessages: true };
  }
  async received(id: string) {
    demand(
      /^[a-f0-9-]{36}$/i.test(id),
      "EMAIL_ID_INVALID",
      "Identificador de e-mail inválido",
      409,
    );
    return this.call(`/emails/receiving/${id}?html_format=cid`, "GET");
  }
  async sent(id: string) {
    demand(
      /^[a-f0-9-]{36}$/i.test(id),
      "EMAIL_ID_INVALID",
      "Identificador de e-mail inválido",
      409,
    );
    return this.call(`/emails/${id}`, "GET");
  }
  async send(input: {
    destination: string;
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  }) {
    // Caller performs live domain verification and final consent guard immediately before this request.
    demand(
      this.config.provider === "resend" &&
        this.config.token &&
        emailAddress(this.config.from_email || "") ===
          emailAddress(input.destination),
      "EMAIL_NOT_CONFIGURED",
      "Conta de e-mail não configurada",
      503,
    );
    demand(
      input.subject.length > 0 &&
        input.subject.length <= 200 &&
        !/[\r\n]/.test(input.subject) &&
        input.text.length > 0 &&
        input.text.length <= 30000 &&
        /^[A-Za-z0-9:_/.-]{8,256}$/.test(input.idempotencyKey),
      "EMAIL_PAYLOAD_INVALID",
      "Assunto, texto ou idempotência inválidos",
    );
    const result = await this.call(
      "/emails",
      "POST",
      {
        from: emailAddress(input.destination),
        to: [emailAddress(input.to)],
        subject: input.subject,
        text: input.text,
      },
      input.idempotencyKey,
    );
    if (typeof result.id !== "string" || !/^[a-f0-9-]{36}$/i.test(result.id))
      throw new ProviderFailure("uncertain", "EMAIL_RECEIPT_MISSING");
    return { externalId: result.id };
  }
}
