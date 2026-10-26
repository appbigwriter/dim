import { z } from "zod";
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
export type WhatsappComponent = {
  type: string;
  sub_type?: string;
  index?: string;
  parameters: any[];
};
export const templateComponentInput = z
  .object({
    header: z
      .union([
        z
          .object({ type: z.literal("text"), text: z.string().min(1).max(60) })
          .strict(),
        z
          .object({
            type: z.enum(["image", "video", "document"]),
            id: z.string().regex(/^\d{1,80}$/),
            filename: z.string().min(1).max(240).optional(),
          })
          .strict(),
      ])
      .optional(),
    buttons: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(9),
            type: z.enum(["url", "quick_reply"]),
            value: z.string().min(1).max(2048),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict();
export type TemplateComponentInput = z.input<typeof templateComponentInput>;
function variableCount(value: string) {
  const placeholders = [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map(
    (m) => m[1],
  );
  demand(
    placeholders.every((v) => /^\d+$/.test(v)),
    "TEMPLATE_COMPONENT_UNSUPPORTED",
    "Parâmetros nomeados exigem adaptador específico",
  );
  const positions = [...new Set(placeholders.map(Number))].sort(
    (a, b) => a - b,
  );
  demand(
    positions.every((n, i) => n === i + 1),
    "TEMPLATE_PARAMETERS_REQUIRED",
    "Parâmetros posicionais devem ser consecutivos",
  );
  return positions.length;
}
export function templateParameters(
  template: any,
  values: string[],
  input: TemplateComponentInput = {},
): WhatsappComponent[] | undefined {
  const supplied = templateComponentInput.parse(input);
  const definitions = template.content?.components || [];
  demand(
    definitions.every((c: any) =>
      ["BODY", "HEADER", "FOOTER", "BUTTONS"].includes(c.type),
    ),
    "TEMPLATE_COMPONENT_UNSUPPORTED",
    "Componente de template não suportado",
  );
  const count = variableCount(
    definitions.find((c: any) => c.type === "BODY")?.text || "",
  );
  demand(
    values.length === count &&
      values.every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 32768,
      ),
    "TEMPLATE_PARAMETERS_REQUIRED",
    `Este template exige ${count} parâmetros de texto em ordem`,
  );
  const result: WhatsappComponent[] = [];
  const header = definitions.find((c: any) => c.type === "HEADER");
  if (header && header.format !== "TEXT") {
    const format = String(header.format).toLowerCase();
    demand(
      ["image", "video", "document"].includes(format),
      "TEMPLATE_COMPONENT_UNSUPPORTED",
      "Formato do cabeçalho não suportado",
    );
    demand(
      supplied.header?.type === format && "id" in supplied.header,
      "TEMPLATE_HEADER_REQUIRED",
      "Informe mídia enviada previamente à conta WhatsApp",
    );
    const media = supplied.header as {
      type: string;
      id: string;
      filename?: string;
    };
    demand(
      !media.filename || format === "document",
      "INVALID_TEMPLATE_HEADER",
      "Nome de arquivo somente para documento",
    );
    result.push({
      type: "header",
      parameters: [
        {
          type: format,
          [format]: {
            id: media.id,
            ...(media.filename ? { filename: media.filename } : {}),
          },
        },
      ],
    });
  } else if (header && variableCount(header.text || "")) {
    demand(
      variableCount(header.text) === 1 && supplied.header?.type === "text",
      "TEMPLATE_HEADER_REQUIRED",
      "Informe o parâmetro de texto do cabeçalho",
    );
    result.push({
      type: "header",
      parameters: [{ type: "text", text: supplied.header.text }],
    });
  } else
    demand(
      !supplied.header,
      "INVALID_TEMPLATE_HEADER",
      "Este template não recebe parâmetro de cabeçalho",
    );
  if (values.length)
    result.push({
      type: "body",
      parameters: values.map((text) => ({ type: "text", text })),
    });
  const buttons =
    definitions.find((c: any) => c.type === "BUTTONS")?.buttons || [];
  demand(
    new Set(supplied.buttons.map((b) => b.index)).size ===
      supplied.buttons.length,
    "INVALID_TEMPLATE_BUTTON",
    "Índices de botão duplicados",
  );
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index],
      value = supplied.buttons.find((b) => b.index === index);
    demand(
      ["URL", "QUICK_REPLY", "PHONE_NUMBER"].includes(button.type),
      "TEMPLATE_COMPONENT_UNSUPPORTED",
      "Tipo de botão ainda não suportado",
    );
    if (
      button.type === "QUICK_REPLY" ||
      (button.type === "URL" && variableCount(button.url || ""))
    ) {
      const kind = button.type === "URL" ? "url" : "quick_reply";
      demand(
        value?.type === kind,
        "TEMPLATE_BUTTON_REQUIRED",
        `Informe parâmetro do botão ${index}`,
      );
      if (kind === "url")
        demand(
          variableCount(button.url) === 1 &&
            button.url.endsWith("{{1}}") &&
            /^https:\/\//i.test(button.url),
          "INVALID_TEMPLATE_BUTTON",
          "URL dinâmica deve usar um sufixo HTTPS aprovado",
        );
      result.push({
        type: "button",
        sub_type: kind,
        index: String(index),
        parameters: [
          kind === "url"
            ? { type: "text", text: value.value }
            : { type: "payload", payload: value.value },
        ],
      });
    } else
      demand(
        !value,
        "INVALID_TEMPLATE_BUTTON",
        "Botão estático não recebe parâmetro",
      );
  }
  demand(
    supplied.buttons.every((b) => b.index < buttons.length),
    "INVALID_TEMPLATE_BUTTON",
    "Índice de botão inexistente",
  );
  return result.length ? result : undefined;
}
