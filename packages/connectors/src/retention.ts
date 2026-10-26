import { createClient } from "@supabase/supabase-js";
import { demand } from "../../contracts/src/index";
import { canonicalHash } from "../../contracts/src/audience";
import type {
  ErasureProvider,
  PurgePlan,
  PurgeReceipt,
} from "../../core/src/retention";
import type { Vault } from "./index";
function endpoint(value: string, allowLocal: boolean) {
  const url = new URL(value);
  demand(
    !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === "https:" ||
        (allowLocal &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))),
    "ERASURE_ENDPOINT_INVALID",
    "Endpoint deve usar HTTPS e configuracao explicita",
    503,
  );
  return url;
}
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  demand(reader, "ERASURE_RESPONSE_INVALID", "Recibo ausente", 502);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      demand(
        size <= 1048576,
        "ERASURE_RESPONSE_INVALID",
        "Recibo excede limite",
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
    demand(false, "ERASURE_RESPONSE_INVALID", "Recibo invalido", 502);
  }
}
export function erasureProvider(
  vault: Vault,
  request: typeof fetch = fetch,
  allowLocalHttp = false,
): ErasureProvider {
  return {
    async execute(plan: PurgePlan, expected: PurgeReceipt, uncertain: boolean) {
      const secret = await vault.get(
        `dim/${plan.organizationId}/retention/${plan.destination.id}`,
      );
      demand(
        secret.organization_id === plan.organizationId &&
          secret.destination_id === plan.destination.id &&
          secret.kind === plan.destination.kind,
        "ERASURE_CONNECTION_SCOPE",
        "Cofre deve confirmar tenant, destino e tipo",
        503,
      );
      if (plan.destination.kind === "storage") {
        demand(
          secret.supabase_url &&
            secret.service_role_key &&
            secret.bucket === "dim-private",
          "ERASURE_STORAGE_CONFIG",
          "Configure Storage privado no cofre",
          503,
        );
        const base = endpoint(secret.supabase_url, allowLocalHttp);
        demand(
          plan.targets.every(
            (t) =>
              t.bucket === secret.bucket &&
              typeof t.object_path === "string" &&
              t.object_path.startsWith(`${plan.organizationId}/`) &&
              !t.object_path.includes(".."),
          ),
          "ERASURE_TARGET_SCOPE",
          "Arquivo fora do tenant",
          403,
        );
        const client = createClient(base.href, secret.service_role_key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: ((url: any, opts: any) =>
              request(url, {
                ...opts,
                redirect: "error",
                signal: AbortSignal.timeout(10000),
              })) as typeof fetch,
          },
        });
        if (plan.targets.length) {
          const result = await client.storage
            .from(secret.bucket)
            .remove(plan.targets.map((t) => t.object_path));
          demand(
            !result.error,
            "ERASURE_STORAGE_UNAVAILABLE",
            "Storage nao confirmou remocao",
            502,
          );
        }
        const checks = await Promise.all(
          plan.targets.map(async (target) => {
            const result = await client.storage
              .from(secret.bucket)
              .exists(target.object_path);
            const error = result.error as any;
            const status = Number(
              error?.status ||
                error?.statusCode ||
                error?.originalError?.status,
            );
            demand(
              result.data === false && (!error || status === 404),
              "ERASURE_STORAGE_READBACK",
              "Objeto ainda existe ou readback nao confirmado",
              502,
            );
          }),
        );
        void checks;
        return expected;
      }
      demand(
        secret.endpoint && secret.token,
        "ERASURE_CONNECTION_REQUIRED",
        "Configure executor de exclusao e readback oficial no cofre",
        503,
      );
      const base = endpoint(secret.endpoint, allowLocalHttp),
        statusUrl = new URL(base);
      statusUrl.pathname =
        statusUrl.pathname.replace(/\/$/, "") +
        `/operations/${encodeURIComponent(expected.operationId)}`;
      const headers = {
        Authorization: `Bearer ${secret.token}`,
        Accept: "application/json",
      };
      const status = await request(statusUrl, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (status.ok) {
        const receipt = await boundedJson(status);
        demand(
          canonicalHash(receipt) === canonicalHash(expected),
          "ERASURE_RECEIPT_MISMATCH",
          "Readback nao corresponde ao recibo esperado",
          502,
        );
        return receipt;
      }
      demand(
        status.status === 404 && !uncertain,
        "ERASURE_READBACK_REQUIRED",
        "Operacao incerta exige readback; nao reenviar exclusao",
        409,
      );
      const response = await request(base, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": expected.operationId,
        },
        body: JSON.stringify({ plan, expectedReceipt: expected }),
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      demand(
        response.ok,
        "ERASURE_EXECUTION_UNCONFIRMED",
        "Destino nao confirmou exclusao",
        502,
      );
      const receipt = await boundedJson(response);
      demand(
        canonicalHash(receipt) === canonicalHash(expected),
        "ERASURE_RECEIPT_MISMATCH",
        "Destino retornou recibo divergente",
        502,
      );
      // Confirmation is accepted only after a separate authenticated readback.
      const readback = await request(statusUrl, {
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      demand(
        readback.ok,
        "ERASURE_READBACK_REQUIRED",
        "Readback da exclusao indisponivel",
        502,
      );
      const verified = await boundedJson(readback);
      demand(
        canonicalHash(verified) === canonicalHash(expected),
        "ERASURE_RECEIPT_MISMATCH",
        "Readback retornou outro recibo",
        502,
      );
      return verified;
    },
  };
}
