import { z } from "zod";
export const uuid = z.string().uuid();
export const text = z.string().trim().min(1).max(4000);
export const timestamp = z.iso.datetime({ offset: true });
export const json = z.record(z.string(), z.json());
export const identityTypes = ["human", "virtual", "hybrid"] as const;
export const states = [
  "draft",
  "under_review",
  "changes_required",
  "approved",
  "provisioning",
  "ready",
  "active",
  "paused",
  "restricted",
  "offboarding",
  "archived",
] as const;
export const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Fuso horário inválido");
export const identityInput = z.object({
  public_name: text,
  internal_name: text,
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  type: z.enum(identityTypes),
  primary_language: z.enum(["pt-BR", "en", "es"]).default("pt-BR"),
  timezone: timezone.default("America/Sao_Paulo"),
  niche: text.optional(),
  owner_user_id: uuid,
});
export const transitionInput = z.object({
  status: z.enum(states),
  reason: text,
  row_version: z.number().int().positive(),
});
export const versionInput = z.object({
  body_text: text.max(30000),
  language: z.enum(["pt-BR", "en", "es"]),
  format: z.enum(["text", "article", "caption"]),
  body: json.default({}),
  source_urls: z
    .array(z.url({ protocol: /^https$/ }))
    .max(30)
    .default([]),
  asset_ids: z.array(uuid).max(20).default([]),
});
export const approvalInput = z.object({
  content_version_id: uuid,
  decision: z.enum(["approved", "rejected", "changes_requested"]),
  rationale: text,
});
export const publicationInput = z.object({
  social_account_id: uuid,
  content_version_id: uuid,
  scheduled_at: timestamp,
});
export const pageInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().max(100).optional(),
  type: z.enum(identityTypes).optional(),
  status: z.string().max(60).optional(),
  niche: z.string().max(100).optional(),
  influencer_id: uuid.optional(),
});
export type Identity = z.infer<typeof identityInput> & {
  id: string;
  organization_id: string;
  status: (typeof states)[number];
  row_version: number;
  created_at: string;
};
export type Actor = {
  userId: string;
  organizationId: string;
  aal: string;
  grants: { permission: string; scopeType: string; scopeId: string | null }[];
  correlationId: string;
};
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function demand(
  condition: unknown,
  code: string,
  message: string,
  status = 422,
): asserts condition {
  if (!condition) throw new AppError(status, code, message);
}
