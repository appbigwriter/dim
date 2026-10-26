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
      "id,name,status,language,category,parameter_format,components",
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
    named_body: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        z.string().min(1).max(32768),
      )
      .refine((value) => Object.keys(value).length <= 100)
      .optional(),
    header: z
      .union([
        z
          .object({
            type: z.literal("text"),
            text: z.string().min(1).max(60),
            parameter_name: z
              .string()
              .regex(/^[a-z][a-z0-9_]{0,63}$/)
              .optional(),
          })
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
function variables(value: string): string[] {
  demand(
    typeof value === "string" && value.length <= 32768,
    "TEMPLATE_DEFINITION_INVALID",
    "Texto do template fora do limite",
  );
  const placeholders = [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map(
    (m) => m[1],
  );
  demand(
    placeholders.every((value) => /^\d+$/.test(value)) ||
      placeholders.every((value) => /^[a-z][a-z0-9_]{0,63}$/.test(value)),
    "TEMPLATE_PARAMETERS_MIXED",
    "Parâmetros nomeados e posicionais não podem ser misturados",
  );
  if (placeholders.some((value) => !/^\d+$/.test(value)))
    return [...new Set(placeholders)];
  const positions = [...new Set(placeholders.map(Number))].sort(
    (a, b) => a - b,
  );
  demand(
    positions.every((n, i) => n === i + 1),
    "TEMPLATE_PARAMETERS_REQUIRED",
    "Parâmetros posicionais devem ser consecutivos",
  );
  return positions.map(String);
}
function rendered(text: string, values: Record<string, string>) {
  return text.replace(
    /\{\{([^{}]+)\}\}/g,
    (_match, name: string) => values[name] || "",
  );
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
  demand(
    definitions.length <= 4 &&
      new Set(definitions.map((value: any) => value.type)).size ===
        definitions.length,
    "TEMPLATE_DEFINITION_INVALID",
    "Componentes duplicados ou acima do limite",
  );
  const body = definitions.find((c: any) => c.type === "BODY")?.text || "";
  const bodyVariables = variables(body),
    named = bodyVariables.some((value) => !/^\d+$/.test(value));
  const count = bodyVariables.length;
  demand(
    count <= 100,
    "TEMPLATE_PARAMETERS_REQUIRED",
    "Corpo deve conter até 100 parâmetros",
  );
  const format =
    template.content?.parameter_format || template.parameter_format;
  const textVariables = [
    ...bodyVariables,
    ...variables(
      definitions.find(
        (component: any) =>
          component.type === "HEADER" && component.format === "TEXT",
      )?.text || "",
    ),
  ];
  demand(
    !format ||
      (["NAMED", "POSITIONAL"].includes(format) &&
        textVariables.every((name) =>
          format === "NAMED" ? !/^\d+$/.test(name) : /^\d+$/.test(name),
        )),
    "TEMPLATE_PARAMETER_FORMAT",
    "Formato dos parâmetros diverge do template aprovado",
  );
  demand(
    (named
      ? values.length === 0 &&
        supplied.named_body &&
        bodyVariables.every((name) =>
          Object.hasOwn(supplied.named_body!, name),
        ) &&
        Object.keys(supplied.named_body).length === count
      : !Object.keys(supplied.named_body || {}).length &&
        values.length === count) &&
      values.every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 32768,
      ),
    "TEMPLATE_PARAMETERS_REQUIRED",
    named
      ? `Parâmetros nomeados obrigatórios: ${bodyVariables.join(", ")}`
      : `Este template exige ${count} parâmetros de texto em ordem`,
  );
  const bodyValues = named
    ? supplied.named_body!
    : Object.fromEntries(
        values.map((value, index) => [String(index + 1), value]),
      );
  demand(
    rendered(body, bodyValues).length <=
      (definitions.length === 1 ? 32768 : 1024),
    "TEMPLATE_BODY_TOO_LONG",
    "Texto final do corpo excede o limite do template",
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
  } else if (header && variables(header.text || "").length) {
    const names = variables(header.text),
      parameterName = names[0];
    demand(
      names.length === 1 && supplied.header?.type === "text",
      "TEMPLATE_HEADER_REQUIRED",
      "Informe o parâmetro de texto do cabeçalho",
    );
    demand(
      rendered(header.text, { [parameterName]: supplied.header.text }).length <=
        60 &&
        (!supplied.header.parameter_name ||
          supplied.header.parameter_name === parameterName),
      "INVALID_TEMPLATE_HEADER",
      "Cabeçalho final ou nome de parâmetro difere do template aprovado",
    );
    result.push({
      type: "header",
      parameters: [
        {
          type: "text",
          text: supplied.header.text,
          ...(!/^\d+$/.test(parameterName)
            ? { parameter_name: parameterName }
            : {}),
        },
      ],
    });
  } else
    demand(
      !supplied.header,
      "INVALID_TEMPLATE_HEADER",
      "Este template não recebe parâmetro de cabeçalho",
    );
  if (count)
    result.push({
      type: "body",
      parameters: bodyVariables.map((name) => ({
        type: "text",
        text: bodyValues[name],
        ...(named ? { parameter_name: name } : {}),
      })),
    });
  const footer = definitions.find(
    (component: any) => component.type === "FOOTER",
  );
  demand(
    !footer ||
      (typeof footer.text === "string" &&
        footer.text.length <= 60 &&
        !variables(footer.text).length),
    "TEMPLATE_FOOTER_INVALID",
    "Rodapé deve conter somente texto estático de até 60 caracteres",
  );
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
      (button.type === "URL" && variables(button.url || "").length)
    ) {
      const kind = button.type === "URL" ? "url" : "quick_reply";
      demand(
        value?.type === kind,
        "TEMPLATE_BUTTON_REQUIRED",
        `Informe parâmetro do botão ${index}`,
      );
      if (kind === "url") {
        demand(
          variables(button.url).length === 1 &&
            button.url.endsWith("{{1}}") &&
            /^https:\/\//i.test(button.url),
          "INVALID_TEMPLATE_BUTTON",
          "URL dinâmica deve usar um sufixo HTTPS aprovado",
        );
        const prefix = new URL(button.url.replace("{{1}}", "")),
          final = new URL(button.url.replace("{{1}}", value.value));
        demand(
          final.href.length <= 2000 &&
            final.protocol === "https:" &&
            !final.username &&
            !final.password &&
            final.origin === prefix.origin &&
            !/[\r\n]/.test(value.value),
          "INVALID_TEMPLATE_BUTTON",
          "Sufixo deve preservar a origem HTTPS aprovada e o limite da URL",
        );
      } else
        demand(
          value.value.length <= 128 && !/[\r\n]/.test(value.value),
          "INVALID_TEMPLATE_BUTTON",
          "Payload do botão deve ter até 128 caracteres",
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
