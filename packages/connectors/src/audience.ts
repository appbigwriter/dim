import { demand } from "../../contracts/src/index";
import {
  validateAudienceContext,
  type AudienceBindingInput,
  type AudienceContext,
} from "../../contracts/src/audience";
import type { Vault } from "./index";
export type AudienceProvider = (
  organizationId: string,
  binding: AudienceBindingInput,
) => Promise<AudienceContext>;
export function audienceProvider(
  vault: Vault,
  request: typeof fetch = fetch,
  allowLocalHttp = false,
): AudienceProvider {
  return async (organizationId, binding) => {
    const secret = await vault.get(`dim/${organizationId}/audience-builder`);
    demand(
      secret.read_model_url &&
        secret.token &&
        secret.tenant_id &&
        secret.allowed_project_ids,
      "AUDIENCE_NOT_CONFIGURED",
      "Configure a API oficial de contexto e o escopo no cofre",
      503,
    );
    let allowed: unknown;
    try {
      allowed = JSON.parse(secret.allowed_project_ids);
    } catch {
      allowed = null;
    }
    demand(
      secret.tenant_id === binding.tenant_id &&
        Array.isArray(allowed) &&
        allowed.includes(binding.project_id),
      "AUDIENCE_CONNECTION_SCOPE",
      "Projeto não autorizado para esta organização",
      403,
    );
    const url = new URL(secret.read_model_url);
    demand(
      !url.username &&
        !url.password &&
        !url.hash &&
        (url.protocol === "https:" ||
          (allowLocalHttp &&
            url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))),
      "AUDIENCE_URL_INVALID",
      "URL de contexto exige HTTPS e não aceita credenciais na URL",
      503,
    );
    url.searchParams.set("tenant_id", binding.tenant_id);
    url.searchParams.set("project_id", binding.project_id);
    url.searchParams.set("persona_id", binding.persona_id);
    let response: Response;
    try {
      response = await request(url, {
        headers: {
          Authorization: `Bearer ${secret.token}`,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      demand(
        false,
        "AUDIENCE_UNAVAILABLE",
        "Audience Builder indisponível",
        503,
      );
    }
    demand(
      response.ok,
      "AUDIENCE_READBACK_FAILED",
      "A API do Audience não confirmou o contexto",
      503,
    );
    const reader = response.body?.getReader();
    demand(reader, "AUDIENCE_EMPTY_RESPONSE", "Contexto ausente", 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        demand(
          size <= 1048576,
          "AUDIENCE_RESPONSE_TOO_LARGE",
          "Contexto excede 1 MB",
          502,
        );
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      demand(false, "AUDIENCE_INVALID_JSON", "Contexto não é JSON válido", 502);
    }
    return validateAudienceContext(body, binding);
  };
}
