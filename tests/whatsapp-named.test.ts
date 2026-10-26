import { test } from "node:test";
import assert from "node:assert/strict";
import { templateParameters } from "../packages/connectors/src/templates";
const namedTemplate = {
  content: {
    parameter_format: "NAMED",
    components: [
      { type: "HEADER", format: "TEXT", text: "Pedido {{order_id}}" },
      {
        type: "BODY",
        text: "Olá {{customer_name}}. Pedido {{order_id}} confirmado, {{customer_name}}.",
      },
    ],
  },
};
test("WhatsApp named HEADER and BODY preserve approved names and repeated placeholders use one parameter", () => {
  const components = templateParameters(namedTemplate, [], {
    header: { type: "text", text: "123" },
    named_body: { order_id: "123", customer_name: "Maria" },
  });
  assert.deepEqual(components, [
    {
      type: "header",
      parameters: [{ type: "text", text: "123", parameter_name: "order_id" }],
    },
    {
      type: "body",
      parameters: [
        { type: "text", text: "Maria", parameter_name: "customer_name" },
        { type: "text", text: "123", parameter_name: "order_id" },
      ],
    },
  ]);
  assert.throws(
    () =>
      templateParameters(namedTemplate, ["Maria", "123"], {
        header: { type: "text", text: "123" },
      }),
    /nomeados/,
  );
  assert.throws(() =>
    templateParameters(namedTemplate, [], {
      header: { type: "text", text: "123", parameter_name: "wrong" },
      named_body: { customer_name: "Maria", order_id: "123" },
    }),
  );
  assert.throws(
    () =>
      templateParameters(namedTemplate, [], {
        header: { type: "text", text: "123" },
        named_body: {
          customer_name: "Maria",
          order_id: "123",
          extra: "rejected",
        },
      }),
    /nomeados/,
  );
  assert.throws(
    () =>
      templateParameters(
        {
          content: {
            components: [{ type: "BODY", text: "Mixed {{name}} and {{1}}" }],
          },
        },
        ["value"],
        { named_body: { name: "Maria" } },
      ),
    /misturados/,
  );
});
test("WhatsApp rendered component limits apply after substitution without arbitrary URL host changes", () => {
  assert.throws(
    () =>
      templateParameters(namedTemplate, [], {
        header: { type: "text", text: "a".repeat(60) },
        named_body: { customer_name: "Maria", order_id: "123" },
      }),
    /Cabeçalho/,
  );
  assert.throws(
    () =>
      templateParameters(namedTemplate, [], {
        header: { type: "text", text: "123" },
        named_body: { customer_name: "a".repeat(1024), order_id: "123" },
      }),
    /corpo/,
  );
  assert.equal(
    templateParameters(
      { content: { components: [{ type: "BODY", text: "{{name}}" }] } },
      [],
      { named_body: { name: "a".repeat(32768) } },
    )?.[0].parameters[0].text.length,
    32768,
  );
  const quick = {
    content: {
      components: [
        { type: "BODY", text: "Hello" },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY" }] },
      ],
    },
  };
  assert.throws(
    () =>
      templateParameters(quick, [], {
        buttons: [{ index: 0, type: "quick_reply", value: "a".repeat(129) }],
      }),
    /128/,
  );
  const dynamic = {
    content: {
      components: [
        { type: "BODY", text: "Hello" },
        {
          type: "BUTTONS",
          buttons: [{ type: "URL", url: "https://approved.example.org{{1}}" }],
        },
      ],
    },
  };
  assert.throws(
    () =>
      templateParameters(dynamic, [], {
        buttons: [{ index: 0, type: "url", value: ".evil.example/" }],
      }),
    /origem/,
  );
  assert.equal(
    templateParameters(dynamic, [], {
      buttons: [{ index: 0, type: "url", value: "/approved-path" }],
    })?.[0].parameters[0].text,
    "/approved-path",
  );
  assert.throws(
    () =>
      templateParameters(
        {
          content: {
            parameter_format: "POSITIONAL",
            components: [{ type: "BODY", text: "{{name}}" }],
          },
        },
        [],
        { named_body: { name: "Maria" } },
      ),
    /Formato/,
  );
});
