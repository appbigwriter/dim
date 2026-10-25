import { createHash } from "node:crypto";
import { z } from "zod";
import { demand } from "./index";
const id = z
    .string()
    .min(1)
    .max(160)
    .refine((v) => v.trim().length > 0),
  line = z
    .string()
    .min(1)
    .max(16000)
    .refine((v) => v.trim().length > 0),
  lines = z.array(line).max(200);
const plan = z
  .object({
    channel: z.enum(["blog", "social", "youtube"]),
    objective: line,
    audience: lines.min(1),
    formats: lines.min(1),
    cadence: line,
    pillars: lines,
    disclosure: line,
    constraints: lines,
    planStatus: z.enum(["planned", "configured"]),
    versionId: id,
  })
  .passthrough();
// Mirrors audience-builder.persona-intake.v1. Extra snapshot fields are preserved in the hash.
export const audiencePersonaPackage = z
  .object({
    contractVersion: z.literal(1),
    personaId: id,
    personaVersionId: id,
    personaVersion: z.number().int().positive(),
    status: z.literal("approved"),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    approval: z
      .object({
        approvalId: id,
        approvedBy: id,
        approvedAt: z.iso.datetime({ offset: true }),
        approvalScope: line,
        approvedVersions: z.array(id).min(1),
      })
      .passthrough(),
    snapshot: z
      .object({
        characterBible: z
          .object({
            name: line,
            bio: line,
            originStory: line,
            mission: line,
            positioning: line,
            centralPromise: line,
            values: lines.min(1),
            tensions: lines,
          })
          .passthrough(),
        physicalIdentityBible: z
          .object({
            physicalDescription: line,
            continuityAnchors: lines.min(1),
            avatarReferenceAssetIds: lines,
          })
          .passthrough(),
        visualConsistencyProfile: z
          .object({
            styleTokens: lines.min(1),
            visualPrompts: lines.min(1),
            negativePrompts: lines,
            aiDisclosure: line,
          })
          .passthrough(),
        editorialProfile: z
          .object({
            voice: line,
            vocabulary: lines.min(1),
            recurringExpressions: lines,
            audience: lines.min(1),
            painPoints: lines.min(1),
            desires: lines.min(1),
            fears: lines,
            objections: lines,
            editorialPillars: lines.min(1),
            priorityTopics: lines.min(1),
            prohibitedTopics: lines.min(1),
            claims: z.array(
              z.object({ text: line, allowed: z.boolean() }).passthrough(),
            ),
            guardrails: lines.min(1),
            qualityCriteria: lines.min(1),
            reviewCriteria: lines.min(1),
          })
          .passthrough(),
        channelPlans: z
          .object({ blog: plan, social: plan, youtube: plan })
          .strict(),
        potentialNiches: z.array(
          z
            .object({
              nicheId: id,
              label: line,
              origin: line,
              observedAt: z.iso.datetime({ offset: true }),
              confidence: z.number().min(0).max(1),
              evidence: lines,
              limitations: lines.min(1),
              signals: lines,
            })
            .passthrough(),
        ),
        disclosurePolicy: z
          .object({
            aiDisclosureRequired: z.boolean(),
            affiliateDisclosureTemplate: line,
            sensitiveTopicsPolicy: line,
          })
          .passthrough(),
      })
      .passthrough(),
    meta: z.object({ testOnly: z.literal(false) }).passthrough(),
  })
  .passthrough();
export const audienceBindingInput = z
  .object({ tenant_id: id, project_id: id, persona_id: id })
  .strict();
export type AudienceBindingInput = z.infer<typeof audienceBindingInput>;
// New DIM consumer contract, prepared locally; the Audience export API still needs to implement it.
export const audienceContextSchema = z
  .object({
    contractId: z.literal("dim.audience-context.v1"),
    contractVersion: z.literal(1),
    source: z.literal("audience-builder"),
    tenantId: id,
    projectId: id,
    contextVersion: z.number().int().positive(),
    contextHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    personaPackage: audiencePersonaPackage,
    authority: z
      .object({
        version: z.number().int().positive(),
        objectives: lines,
        editorialPillars: lines.min(1),
        milestones: z.array(
          z
            .object({
              id,
              title: line,
              status: z.enum([
                "planned",
                "in_progress",
                "completed",
                "blocked",
              ]),
            })
            .strict(),
        ),
      })
      .strict(),
    blogs: z
      .array(
        z
          .object({
            id,
            name: line,
            version: z.number().int().positive(),
            url: z.url({ protocol: /^https$/ }).nullable(),
            status: z.enum([
              "draft",
              "provisioning",
              "active",
              "paused",
              "archived",
            ]),
            readbackVerified: z.boolean(),
            receiptId: id.nullable(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type AudienceContext = z.infer<typeof audienceContextSchema>;
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}
export function canonicalHash(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
export function audienceContextHash(
  value: Omit<AudienceContext, "contextHash"> | AudienceContext,
) {
  const { contextHash: _ignored, ...body } = value as AudienceContext;
  return canonicalHash(body);
}
export function validateAudienceContext(
  value: unknown,
  expected: AudienceBindingInput,
): AudienceContext {
  function checkKeys(item: unknown, depth = 0): void {
    demand(
      depth <= 40,
      "AUDIENCE_CONTEXT_DEPTH",
      "Contexto excede a profundidade permitida",
      422,
    );
    if (!item || typeof item !== "object") return;
    for (const [key, value] of Object.entries(item)) {
      demand(
        !/^(token|access_?token|refresh_?token|bearer_?token|password|secret|secret_?value|client_?secret|service_?role(_?key)?|api_?key|private_?key|authorization|credentials)$/i.test(
          key,
        ),
        "AUDIENCE_SECRET_IN_CONTEXT",
        "O contexto não pode transportar credenciais",
        422,
      );
      checkKeys(value, depth + 1);
    }
  }
  checkKeys(value);
  const parsed = audienceContextSchema.safeParse(value);
  demand(
    parsed.success,
    "AUDIENCE_INVALID_CONTEXT",
    "O Audience não retornou um contexto aprovado e completo",
    422,
  );
  const context = parsed.data,
    p = context.personaPackage;
  demand(
    context.tenantId === expected.tenant_id &&
      context.projectId === expected.project_id &&
      p.personaId === expected.persona_id,
    "AUDIENCE_SCOPE_MISMATCH",
    "Contexto pertence a outro tenant, projeto ou persona",
    403,
  );
  demand(
    p.approval.approvedVersions.includes(p.personaVersionId),
    "AUDIENCE_APPROVAL_MISMATCH",
    "A aprovação não cobre a versão da persona",
    422,
  );
  demand(
    Date.parse(p.approval.approvedAt) <= Date.now() + 300000,
    "AUDIENCE_APPROVAL_DATE",
    "Data de aprovação no futuro",
    422,
  );
  demand(
    canonicalHash(p.snapshot) === p.contentHash,
    "AUDIENCE_PERSONA_HASH_MISMATCH",
    "Snapshot da persona diverge da aprovação",
    422,
  );
  demand(
    audienceContextHash(context) === context.contextHash,
    "AUDIENCE_CONTEXT_HASH_MISMATCH",
    "Trajetória, blogs ou persona divergiram do contexto",
    422,
  );
  for (const channel of ["blog", "social", "youtube"] as const)
    demand(
      p.snapshot.channelPlans[channel].channel === channel,
      "AUDIENCE_CHANNEL_PLAN_MISMATCH",
      "Plano de canal incompatível",
      422,
    );
  return context;
}
