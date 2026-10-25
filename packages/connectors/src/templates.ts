import { demand } from "../../contracts/src/index";
export async function fetchWhatsappTemplates(
  token: string,
  wabaId: string,
  version: string,
  request: typeof fetch = fetch,
) {
  demand(
    /^\d+$/.test(wabaId) && /^v\d+\.\d+$/.test(version),
    "INVALID_PROVIDER_CONFIG",
    "WABA ou versão Graph inválidos",
  );
  const templates: any[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const url = new URL(
      `https://graph.facebook.com/${version}/${wabaId}/message_templates`,
    );
    url.searchParams.set(
      "fields",
      "id,name,status,language,category,components",
    );
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("after", cursor);
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    demand(
      response.ok,
      "TEMPLATES_UNAVAILABLE",
      "Falha ao consultar templates",
      502,
    );
    const result = await response.json();
    demand(
      Array.isArray(result.data),
      "INVALID_PROVIDER_RESPONSE",
      "Resposta de templates inválida",
      502,
    );
    templates.push(...result.data);
    if (!result.paging?.next) return templates;
    // Only the opaque cursor is reused. Never follow a provider-supplied URL with credentials.
    cursor = result.paging?.cursors?.after;
    demand(
      typeof cursor === "string" && cursor.length > 0 && !seen.has(cursor),
      "INVALID_PAGINATION",
      "Paginação inválida ou repetida",
      502,
    );
    seen.add(cursor);
  }
  throw new Error("Limite de paginação excedido; sincronização não aplicada");
}
export function templateParameters(template: any, values: string[]) {
  const components = template.content?.components || [];
  demand(
    !components.some(
      (c: any) =>
        c.type !== "BODY" &&
        (JSON.stringify(c).includes("{{") ||
          ["HEADER", "BUTTONS"].includes(c.type)),
    ),
    "TEMPLATE_COMPONENT_UNSUPPORTED",
    "Este template exige componentes ainda não habilitados",
  );
  const body = components.find((c: any) => c.type === "BODY")?.text || "";
  const positions = [
    ...new Set(
      [...body.matchAll(/\{\{(\d+)\}\}/g)].map((m: any) => Number(m[1])),
    ),
  ].sort((a: any, b: any) => a - b) as number[];
  demand(
    positions.every((n, i) => n === i + 1) &&
      values.length === positions.length,
    "TEMPLATE_PARAMETERS_REQUIRED",
    `Este template exige ${positions.length} parâmetros de texto em ordem`,
  );
  return values.length
    ? [
        {
          type: "body",
          parameters: values.map((text) => ({ type: "text", text })),
        },
      ]
    : undefined;
}
