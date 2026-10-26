import { z } from "zod";
import { demand, uuid } from "./index";
import { canonicalHash, type AudienceBindingInput } from "./audience";

const id = z.string().min(1).max(180);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const audienceAction = z
  .object({
    contractId: z.literal("dim.audience-action.v1"),
    actionId: id,
    tenantId: id,
    projectId: id,
    personaId: id,
    contextVersion: z.number().int().positive(),
    contextHash: digest,
    kind: z.literal("publication"),
    channel: z.enum([
      "blog",
      "instagram",
      "facebook",
      "x",
      "whatsapp",
      "telegram",
      "email",
      "youtube",
      "crm",
    ]),
    targetAccountId: uuid,
    scheduledAt: z.iso.datetime({ offset: true }),
    content: z
      .object({
        text: z.string().min(1).max(30000),
        title: z.string().min(1).max(300).optional(),
        mediaAssetIds: z.array(uuid).max(20).default([]),
        sourceUrls: z
          .array(z.url({ protocol: /^https$/ }))
          .max(30)
          .default([]),
        language: z.enum(["pt-BR", "en", "es"]).default("pt-BR"),
        video: z
          .object({
            madeForKids: z.boolean(),
            privacyStatus: z.enum(["private", "unlisted", "public"]),
          })
          .strict()
          .optional(),
      })
      .strict(),
    approval: z
      .object({
        approvalId: id,
        approvedBy: id,
        approvedAt: z.iso.datetime({ offset: true }),
        expiresAt: z.iso.datetime({ offset: true }),
      })
      .strict(),
    idempotencyKey: z.string().min(8).max(180),
    actionHash: digest,
  })
  .strict();
export type AudienceAction = z.infer<typeof audienceAction>;
export function audienceActionHash(
  action: Omit<AudienceAction, "actionHash"> | AudienceAction,
) {
  const { actionHash: _hash, ...body } = action as AudienceAction;
  return canonicalHash(body);
}
export function validateAudienceAction(
  input: unknown,
  binding: AudienceBindingInput,
  now = Date.now(),
) {
  const action = audienceAction.parse(input);
  demand(
    action.channel !== "youtube" ||
      !!(
        action.content.video &&
        action.content.title &&
        action.content.title.length <= 100
      ),
    "AUDIENCE_YOUTUBE_DECLARATION",
    "YouTube exige título e declaração de público e privacidade aprovados",
    422,
  );
  demand(
    action.tenantId === binding.tenant_id &&
      action.projectId === binding.project_id &&
      action.personaId === binding.persona_id,
    "AUDIENCE_ACTION_SCOPE",
    "Ação pertence a outro projeto, tenant ou persona",
    403,
  );
  demand(
    audienceActionHash(action) === action.actionHash,
    "AUDIENCE_ACTION_HASH",
    "Hash da ação diverge do conteúdo aprovado",
    409,
  );
  demand(
    new Date(action.approval.approvedAt).getTime() <= now + 300000 &&
      new Date(action.approval.expiresAt).getTime() > now &&
      new Date(action.approval.expiresAt) >
        new Date(action.approval.approvedAt),
    "AUDIENCE_ACTION_EXPIRED",
    "Aprovação da origem ausente ou expirada",
    409,
  );
  return action;
}
export const audienceReceipt = z
  .object({
    receiptId: uuid,
    actionId: id,
    actionHash: digest,
    status: z.enum([
      "accepted",
      "awaiting_review",
      "scheduled",
      "running",
      "succeeded",
      "failed",
      "uncertain",
      "blocked",
      "cancelled",
    ]),
    occurredAt: z.iso.datetime({ offset: true }),
    externalId: z.string().max(300).optional(),
    errorCode: z
      .string()
      .regex(/^[A-Z0-9_]+$/)
      .max(120)
      .optional(),
  })
  .strict();
export type AudienceReceipt = z.infer<typeof audienceReceipt>;
