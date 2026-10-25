import { AppError, demand, type Actor } from "../../contracts/src/index";
import {
  audienceBindingInput,
  validateAudienceContext,
  type AudienceBindingInput,
} from "../../contracts/src/audience";
import { insert, one, type DB, type Database } from "../../db/src/index";
import type { AudienceProvider } from "../../connectors/src/audience";
import { audit, authorize, event, resource, scoped } from "./security";
import { loadActor } from "./access";
export async function bindAudience(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const data = audienceBindingInput.parse(input);
  await resource(db, "influencers", id, actor);
  authorize(actor, "security.write");
  authorize(actor, "governance.write", { influencerId: id });
  await db.query(
    "SELECT id FROM custom_dim.influencers WHERE id=$1 FOR UPDATE",
    [id],
  );
  const old = await one(
    db,
    "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1",
    [id],
  );
  if (old) {
    demand(
      old.tenant_id === data.tenant_id &&
        old.project_id === data.project_id &&
        old.persona_id === data.persona_id,
      "AUDIENCE_ALREADY_BOUND",
      "Identidade já vinculada; troca de origem exige migração revisada",
      409,
    );
    return { id: old.id, status: old.status };
  }
  const binding = await insert(db, "audience_bindings", {
    organization_id: actor.organizationId,
    influencer_id: id,
    ...data,
  });
  await db.query(
    "UPDATE custom_dim.influencers SET persona_source='audience_builder',row_version=row_version+1 WHERE id=$1",
    [id],
  );
  await audit(db, actor, "audience_bound", "influencers", id, {
    binding_id: binding.id,
    ...data,
  });
  return { id: binding.id, status: binding.status };
}
export async function audienceState(
  db: DB,
  actor: Actor,
  id: string,
  includeContext = false,
) {
  const identity = await resource(db, "influencers", id, actor);
  authorize(actor, "identity.read", { influencerId: id });
  if (includeContext) authorize(actor, "governance.read", { influencerId: id });
  const binding = await one(
    db,
    "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1",
    [id],
  );
  const current = binding?.current_context_id
    ? await one(
        db,
        "SELECT id,context_version,context_hash,local_persona_id,persona_version_id,persona_version,persona_hash,context FROM custom_dim.audience_context_versions WHERE id=$1",
        [binding.current_context_id],
      )
    : undefined;
  const blockers = await audienceBlockers(db, identity);
  return {
    managed_by:
      identity.persona_source === "audience_builder"
        ? "audience_builder"
        : "legacy_local",
    binding: binding || null,
    blockers,
    current: current
      ? {
          id: current.id,
          context_version: current.context_version,
          context_hash: current.context_hash,
          persona_version_id: current.persona_version_id,
          persona_version: current.persona_version,
          ...(includeContext ? { context: current.context } : {}),
        }
      : null,
  };
}
export async function audienceBlockers(
  db: DB,
  identity: any,
): Promise<string[]> {
  if (identity.persona_source !== "audience_builder") return [];
  const binding = await one(
    db,
    "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1 AND organization_id=$2",
    [identity.id, identity.organization_id],
  );
  if (!binding) return ["audience_binding_required"];
  if (binding.status !== "synced" || !binding.current_context_id)
    return ["audience_context_not_verified"];
  if (
    !binding.last_verified_at ||
    Date.now() - new Date(binding.last_verified_at).getTime() > 86400000
  )
    return ["audience_context_stale"];
  return [];
}
export async function syncAudience(
  db: Database,
  actor: Actor,
  id: string,
  provider: AudienceProvider,
) {
  const initial = await scoped(db, actor, async (tx) => {
    await resource(tx, "influencers", id, actor);
    authorize(actor, "governance.write", { influencerId: id });
    const row = await one(
      tx,
      "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1",
      [id],
    );
    demand(
      row,
      "AUDIENCE_BINDING_REQUIRED",
      "Vincule o projeto Audience antes de sincronizar",
      409,
    );
    return row;
  });
  const expected: AudienceBindingInput = {
    tenant_id: initial.tenant_id,
    project_id: initial.project_id,
    persona_id: initial.persona_id,
  };
  try {
    const context = validateAudienceContext(
        await provider(actor.organizationId, expected),
        expected,
      ),
      pkg = context.personaPackage;
    const currentActor = await loadActor(
      db,
      actor.userId,
      actor.organizationId,
      actor.aal,
      actor.correlationId,
    );
    return await scoped(db, currentActor, async (tx) => {
      authorize(currentActor, "governance.write", { influencerId: id });
      await tx.query(
        "SELECT id FROM custom_dim.influencers WHERE id=$1 FOR UPDATE",
        [id],
      );
      const binding = await one(
        tx,
        "SELECT * FROM custom_dim.audience_bindings WHERE id=$1 FOR UPDATE",
        [initial.id],
      );
      demand(
        binding,
        "AUDIENCE_BINDING_CHANGED",
        "Vínculo não encontrado",
        409,
      );
      const previous = binding.current_context_id
        ? await one(
            tx,
            "SELECT * FROM custom_dim.audience_context_versions WHERE id=$1",
            [binding.current_context_id],
          )
        : undefined;
      if (previous) {
        demand(
          context.contextVersion >= previous.context_version,
          "AUDIENCE_STALE_CONTEXT",
          "Contexto recebido é anterior ao atual",
          409,
        );
        if (context.contextVersion === previous.context_version) {
          demand(
            context.contextHash === previous.context_hash,
            "AUDIENCE_CONTEXT_CONFLICT",
            "Mesma versão de contexto com conteúdo divergente",
            409,
          );
          await tx.query(
            "UPDATE custom_dim.audience_bindings SET status='synced',last_verified_at=now(),last_error_code=NULL WHERE id=$1",
            [binding.id],
          );
          await audit(
            tx,
            currentActor,
            "audience_reverified",
            "influencers",
            id,
            { context_id: previous.id },
          );
          return { synced: true, replay: true, context_id: previous.id };
        }
        demand(
          pkg.personaVersionId !== previous.persona_version_id ||
            pkg.personaVersion === previous.persona_version,
          "AUDIENCE_PERSONA_CONFLICT",
          "Identificador de versão já possui outra numeração",
          409,
        );
        demand(
          pkg.personaVersion >= previous.persona_version,
          "AUDIENCE_STALE_PERSONA",
          "Persona recebida é anterior à atual",
          409,
        );
        if (pkg.personaVersion === previous.persona_version)
          demand(
            pkg.personaVersionId === previous.persona_version_id &&
              pkg.contentHash === previous.persona_hash,
            "AUDIENCE_PERSONA_CONFLICT",
            "Mesma versão de persona com conteúdo divergente",
            409,
          );
      }
      let persona = await one(
        tx,
        "SELECT * FROM custom_dim.influencer_personas WHERE influencer_id=$1 AND source_system='audience_builder' AND source_version_id=$2",
        [id, pkg.personaVersionId],
      );
      if (persona)
        demand(
          persona.source_content_hash === pkg.contentHash,
          "AUDIENCE_PERSONA_CONFLICT",
          "Versão da persona já possui outro hash",
          409,
        );
      else {
        const last = await one(
          tx,
          "SELECT coalesce(max(version),0)::int AS version FROM custom_dim.influencer_personas WHERE influencer_id=$1",
          [id],
        );
        const s = pkg.snapshot,
          e = s.editorialProfile;
        persona = await insert(tx, "influencer_personas", {
          organization_id: actor.organizationId,
          influencer_id: id,
          version: last.version + 1,
          public_bio: s.characterBible.bio,
          tone: {
            voice: e.voice,
            vocabulary: e.vocabulary,
            recurringExpressions: e.recurringExpressions,
          },
          traits: s.characterBible,
          knowledge: {
            audience: e.audience,
            pillars: e.editorialPillars,
            priorityTopics: e.priorityTopics,
          },
          boundaries: {
            guardrails: e.guardrails,
            prohibitedTopics: e.prohibitedTopics,
            claims: e.claims,
            disclosurePolicy: s.disclosurePolicy,
          },
          approval_status: "approved",
          approved_at: pkg.approval.approvedAt,
          source_system: "audience_builder",
          source_persona_id: pkg.personaId,
          source_version_id: pkg.personaVersionId,
          source_content_hash: pkg.contentHash,
        });
      }
      const version = await insert(tx, "audience_context_versions", {
        organization_id: actor.organizationId,
        influencer_id: id,
        binding_id: binding.id,
        context_version: context.contextVersion,
        context_hash: context.contextHash,
        local_persona_id: persona.id,
        persona_version_id: pkg.personaVersionId,
        persona_version: pkg.personaVersion,
        persona_hash: pkg.contentHash,
        context,
      });
      await tx.query(
        "UPDATE custom_dim.audience_bindings SET current_context_id=$1,status='synced',last_verified_at=now(),last_error_code=NULL WHERE id=$2",
        [version.id, binding.id],
      );
      // An upstream strategy/persona change requires a fresh local content version and review.
      await tx.query(
        "UPDATE custom_dim.publication_jobs SET status='cancelled',last_error='AUDIENCE_CONTEXT_CHANGED' WHERE social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$1) AND status IN('queued','retry')",
        [id],
      );
      await tx.query(
        "UPDATE custom_dim.content_items SET status='review_required' WHERE influencer_id=$1 AND status NOT IN('archived')",
        [id],
      );
      await audit(
        tx,
        currentActor,
        "audience_context_imported",
        "influencers",
        id,
        {
          context_id: version.id,
          context_version: context.contextVersion,
          context_hash: context.contextHash,
          persona_version_id: pkg.personaVersionId,
        },
      );
      await event(tx, currentActor, "audience.context_synced", id, {
        context_id: version.id,
        persona_version_id: pkg.personaVersionId,
      });
      return { synced: true, replay: false, context_id: version.id };
    });
  } catch (error) {
    const code =
      error instanceof AppError ? error.code : "AUDIENCE_UNAVAILABLE";
    await db.transaction(async (tx) => {
      const changed = await one(
        tx,
        "UPDATE custom_dim.audience_bindings SET status='degraded',last_error_code=$1 WHERE id=$2 AND current_context_id IS NOT DISTINCT FROM $3::uuid AND last_verified_at IS NOT DISTINCT FROM $4::timestamptz RETURNING id",
        [
          code,
          initial.id,
          initial.current_context_id,
          initial.last_verified_at,
        ],
      );
      if (changed)
        await audit(tx, actor, "audience_sync_failed", "influencers", id, {
          code,
        });
    });
    throw error;
  }
}
