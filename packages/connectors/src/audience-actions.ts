import { demand } from "../../contracts/src/index";
import { type AudienceBindingInput } from "../../contracts/src/audience";
import {
  audienceReceipt,
  validateAudienceAction,
  type AudienceAction,
  type AudienceReceipt,
} from "../../contracts/src/audience-actions";
import type { Vault } from "./index";

export interface AudienceActions {
  list(org: string, binding: AudienceBindingInput): Promise<AudienceAction[]>;
  get(
    org: string,
    binding: AudienceBindingInput,
    actionId: string,
  ): Promise<AudienceAction>;
  receipt(
    org: string,
    binding: AudienceBindingInput,
    receipt: AudienceReceipt,
  ): Promise<void>;
}
export function audienceActions(
  vault: Vault,
  request: typeof fetch = fetch,
  allowLocalHttp = false,
): AudienceActions {
  async function call(
    org: string,
    binding: AudienceBindingInput,
    path: string,
    body?: AudienceReceipt,
  ) {
    const secret = await vault.get(`dim/${org}/audience-builder`);
    let projects: unknown;
    try {
      projects = JSON.parse(secret.allowed_project_ids || "null");
    } catch {
      projects = null;
    }
    demand(
      secret.actions_url &&
        secret.token &&
        secret.tenant_id === binding.tenant_id &&
        Array.isArray(projects) &&
        projects.includes(binding.project_id),
      "AUDIENCE_CONNECTION_SCOPE",
      "Configure ações e escopo do Audience no cofre",
      503,
    );
    const base = new URL(secret.actions_url);
    demand(
      !base.username &&
        !base.password &&
        !base.search &&
        !base.hash &&
        (base.protocol === "https:" ||
          (allowLocalHttp &&
            base.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))),
      "AUDIENCE_URL_INVALID",
      "URL de ações exige HTTPS sem credenciais ou query",
      503,
    );
    base.pathname = base.pathname.replace(/\/$/, "") + path;
    base.searchParams.set("tenant_id", binding.tenant_id);
    base.searchParams.set("project_id", binding.project_id);
    base.searchParams.set("persona_id", binding.persona_id);
    let response: Response;
    try {
      response = await request(base, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${secret.token}`,
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Idempotency-Key": body.receiptId,
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      demand(false, "AUDIENCE_UNAVAILABLE", "Audience indisponível", 503);
    }
    demand(
      response.status !== 410,
      "AUDIENCE_ACTION_REVOKED",
      "Ação revogada na origem",
      410,
    );
    demand(
      response.ok,
      "AUDIENCE_ACTION_READBACK",
      "Audience não confirmou a operação",
      response.status < 500 && response.status !== 429 ? response.status : 503,
    );
    const reader = response.body?.getReader();
    demand(reader, "AUDIENCE_EMPTY_RESPONSE", "Resposta Audience ausente", 502);
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        demand(
          size <= 1048576,
          "AUDIENCE_RESPONSE_TOO_LARGE",
          "Resposta Audience excede 1 MB",
          502,
        );
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      demand(false, "AUDIENCE_INVALID_JSON", "Resposta Audience inválida", 502);
    }
  }
  return {
    async list(org, binding) {
      const result = await call(org, binding, "");
      demand(
        Array.isArray(result.actions) && result.actions.length <= 100,
        "AUDIENCE_ACTION_LIST",
        "Lista de ações inválida",
        502,
      );
      return result.actions.map((action: unknown) =>
        validateAudienceAction(action, binding),
      );
    },
    async get(org, binding, id) {
      return validateAudienceAction(
        await call(org, binding, `/${encodeURIComponent(id)}`),
        binding,
      );
    },
    async receipt(org, binding, input) {
      const receipt = audienceReceipt.parse(input);
      const result = await call(
        org,
        binding,
        `/${encodeURIComponent(receipt.actionId)}/receipts`,
        receipt,
      );
      demand(
        result.receiptId === receipt.receiptId &&
          result.actionHash === receipt.actionHash,
        "AUDIENCE_RECEIPT_MISMATCH",
        "Audience não confirmou o recibo exato",
        502,
      );
    },
  };
}
