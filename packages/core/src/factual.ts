import { z } from "zod";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, one, type DB, type Database } from "../../db/src/index";
import { readSource, type SourceReader } from "../../connectors/src/sources";
import { audit, authorize, resource, scoped } from "./security";
import { loadActor } from "./access";
export const riskPolicyInput = z
  .object({
    allowedSourceDomains: z
      .array(z.string().regex(/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/))
      .max(100),
    blockedTerms: z.array(z.string().min(1).max(200)).max(100).default([]),
    requiredPhrases: z.array(z.string().min(1).max(200)).max(30).default([]),
    requireSourceEvidence: z.boolean(),
    requireFactualReview: z.boolean(),
    maxEvidenceAgeHours: z.number().int().min(1).max(8760),
    requiredApprovals: z.number().int().min(1).max(10).default(1),
  })
  .strict();
export const factReviewInput = z
  .object({
    claims: z
      .array(
        z
          .object({
            claim: z.string().min(1).max(1000),
            sourceUrl: z.url({ protocol: /^https$/ }),
            quote: z.string().min(1).max(1000),
            decision: z.enum(["supported", "contradicted", "unverified"]),
            reason: z.string().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export async function configureRiskPolicy(
  db: DB,
  actor: Actor,
  input: unknown,
) {
  authorize(actor, "security.write");
  const data = riskPolicyInput.parse(input);
  demand(
    await one(
      db,
      "SELECT id FROM custom_dim.organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active'",
      [actor.organizationId, actor.userId],
    ),
    "MEMBERSHIP_REVOKED",
    "Acesso revogado",
    403,
  );
  await db.query(
    "SELECT id FROM custom_dim.organizations WHERE id=$1 FOR UPDATE",
    [actor.organizationId],
  );
  const previous = await one(
    db,
    "SELECT * FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  const row = await insert(db, "approval_policies", {
    organization_id: actor.organizationId,
    code: previous?.code || "editorial",
    resource_type: "content",
    version: (previous?.version || 0) + 1,
    enabled: true,
    conditions: {
      ...(previous?.conditions || {}),
      required_approvals: data.requiredApprovals,
      risk: data,
    },
  });
  await audit(db, actor, "risk_policy_versioned", "approval_policies", row.id, {
    version: row.version,
  });
  return row;
}
export async function factualFlags(
  db: DB,
  actor: Actor,
  version: any,
  _identity: any,
) {
  const policy = await one(
    db,
    "SELECT * FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  if (!policy?.conditions.risk) return [];
  const risk = riskPolicyInput.parse(policy.conditions.risk),
    flags: string[] = [],
    text = String(version.body_text || "").toLocaleLowerCase();
  for (const term of risk.blockedTerms)
    if (text.includes(term.toLocaleLowerCase()))
      flags.push(`risk_blocked_term:${term}`);
  for (const phrase of risk.requiredPhrases)
    if (!text.includes(phrase.toLocaleLowerCase()))
      flags.push(`risk_required_phrase:${phrase}`);
  if (risk.requireSourceEvidence || risk.requireFactualReview) {
    const review = await one(
      db,
      "SELECT * FROM custom_dim.content_verifications WHERE content_version_id=$1 AND payload_hash=$2 AND policy_version=$3 ORDER BY created_at DESC LIMIT 1",
      [version.id, version.payload_hash, policy.version],
    );
    if (!review) flags.push("factual_review_required");
    else if (!review.passed) flags.push("factual_review_failed");
    else if (
      Date.now() - new Date(review.created_at).getTime() >
      risk.maxEvidenceAgeHours * 3600000
    )
      flags.push("factual_evidence_stale");
  }
  return flags;
}
export async function reviewFacts(
  db: Database,
  actor: Actor,
  versionId: string,
  input: unknown,
  reader: SourceReader = readSource,
) {
  const data = factReviewInput.parse(input);
  const initial = await scoped(db, actor, async (tx) => {
    const version = await resource(tx, "content_versions", versionId, actor),
      content = await resource(tx, "content_items", version.content_id, actor);
    authorize(actor, "approval.write", { influencerId: content.influencer_id });
    demand(
      version.created_by !== actor.userId,
      "SELF_APPROVAL",
      "Outro revisor deve verificar os fatos",
      403,
    );
    const policy = await one(
      tx,
      "SELECT * FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
      [actor.organizationId],
    );
    demand(
      policy?.conditions.risk,
      "RISK_POLICY_REQUIRED",
      "Configure os domínios e a política factual",
      409,
    );
    return {
      version,
      content,
      policy,
      risk: riskPolicyInput.parse(policy.conditions.risk),
    };
  });
  const sources = new Map<string, Awaited<ReturnType<SourceReader>>>();
  for (const claim of data.claims) {
    demand(
      initial.version.body.source_urls?.includes(claim.sourceUrl) &&
        initial.version.body_text.includes(claim.claim),
      "FACTUAL_CLAIM_SCOPE",
      "Alegação ou fonte não consta da versão revisada",
      422,
    );
    if (!sources.has(claim.sourceUrl))
      sources.set(
        claim.sourceUrl,
        await reader(claim.sourceUrl, initial.risk.allowedSourceDomains),
      );
  }
  const findings = data.claims.map((c) => ({
    ...c,
    quoteMatched: sources
      .get(c.sourceUrl)!
      .text.replace(/\s+/g, " ")
      .includes(c.quote.replace(/\s+/g, " ")),
  }));
  const fresh = await loadActor(
    db,
    actor.userId,
    actor.organizationId,
    actor.aal,
    actor.correlationId,
  );
  return scoped(db, fresh, async (tx) => {
    authorize(fresh, "approval.write", {
      influencerId: initial.content.influencer_id,
    });
    const latest = await one(
      tx,
      "SELECT id FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
      [initial.content.id],
    );
    const policy = await one(
      tx,
      "SELECT version FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
      [actor.organizationId],
    );
    demand(
      latest?.id === versionId && policy?.version === initial.policy.version,
      "FACTUAL_REVIEW_STALE",
      "Conteúdo ou política mudou durante a conferência",
      409,
    );
    const row = await insert(tx, "content_verifications", {
      organization_id: actor.organizationId,
      influencer_id: initial.content.influencer_id,
      content_version_id: versionId,
      payload_hash: initial.version.payload_hash,
      policy_version: policy.version,
      reviewer_id: actor.userId,
      passed: findings.every(
        (c) => c.decision === "supported" && c.quoteMatched,
      ),
      evidence: [...sources.values()].map(
        ({ text: _text, ...metadata }) => metadata,
      ),
      findings,
    });
    await audit(tx, fresh, "facts_reviewed", "content_versions", versionId, {
      verification_id: row.id,
      passed: row.passed,
    });
    return row;
  });
}
