import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { audienceFixture } from "../tests/audience-fixture";
import {
  audienceActionHash,
  validateAudienceAction,
  audienceReceipt,
  type AudienceAction,
} from "../packages/contracts/src/audience-actions";
// Test-only data. No HTTP, credentials, writes or publication.
const source = await import(
  pathToFileURL(
    resolve(
      process.env.AUDIENCE_CODE_PATH || "../FBR Audience/09-codigo",
      "packages/contracts/dim-execution.ts",
    ),
  ).href
);
const context = audienceFixture();
const scope = {
  tenant_id: context.tenantId,
  project_id: context.projectId,
  persona_id: context.personaPackage.personaId,
};
for (const kind of ["publication", "message", "crm_update"] as const) {
  const action: AudienceAction = {
    contractId: "dim.audience-action.v1",
    actionId: `contract-${kind}`,
    tenantId: context.tenantId,
    projectId: context.projectId,
    personaId: scope.persona_id,
    contextVersion: context.contextVersion,
    contextHash: context.contextHash,
    kind,
    channel:
      kind === "message"
        ? "whatsapp"
        : kind === "crm_update"
          ? "crm"
          : "telegram",
    ...(kind === "crm_update"
      ? {
          crm: {
            contactId: randomUUID(),
            patch: { displayName: "Contrato de teste" },
          },
        }
      : { targetAccountId: randomUUID() }),
    ...(kind === "message"
      ? {
          message: {
            conversationId: randomUUID(),
            purpose: "marketing",
            templateComponents: {
              named_body: { customer: "Ana" },
              header: {
                type: "text",
                text: "Assunto",
                parameter_name: "subject",
              },
              buttons: [],
            },
          },
        }
      : {}),
    content: {
      text: "Persona virtual. Dados exclusivos de teste.",
      sourceUrls: ["https://example.org"],
      mediaAssetIds: [],
      language: "pt-BR",
    },
    scheduledAt: new Date().toISOString(),
    approval: {
      approvalId: "test-approval",
      approvedBy: "test-reviewer",
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    idempotencyKey: `contract-key-${kind}`,
    actionHash: "",
  };
  action.actionHash = audienceActionHash(action);
  assert.equal(source.dimHash(action, "actionHash"), action.actionHash);
  assert.deepEqual(
    validateAudienceAction(
      source.validateDimAction(action, context, "test-reviewer"),
      scope,
    ),
    action,
  );
  const receipt = audienceReceipt.parse({
    receiptId: randomUUID(),
    actionId: action.actionId,
    actionHash: action.actionHash,
    status: "succeeded",
    occurredAt: new Date().toISOString(),
    metrics: { views: 42 },
    metricsObservedAt: new Date().toISOString(),
    metricsProvenance: "test-only",
    cost: { amount: "0.032500", currency: "BRL" },
    evidenceUrls: ["https://example.org/proof"],
  });
  assert.deepEqual(source.validateDimReceipt(receipt, action), receipt);
}
console.log(
  "Audience ↔ DIM: three action kinds, named templates, exact hashes and enriched receipts agree. No external calls.",
);
