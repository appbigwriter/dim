import { randomUUID } from "node:crypto";
import { type Database, insert, one } from "../../../packages/db/src/index";
import { loadActor } from "../../../packages/core/src/access";
import { scoped, audit } from "../../../packages/core/src/security";
import { publicationGuard } from "../../../packages/core/src/editorial";
import {
  type Connector,
  type Vault,
  ProviderFailure,
} from "../../../packages/connectors/src/index";
import { AppError } from "../../../packages/contracts/src/index";
import {
  loadVerifiedMedia,
  type PrivateStorage,
} from "../../../packages/connectors/src/storage";
import type { MediaResolver } from "../../../packages/connectors/src/channels";
import type { AudienceActions } from "../../../packages/connectors/src/audience-actions";
import { demand } from "../../../packages/contracts/src/index";
import { validateAudienceAction } from "../../../packages/contracts/src/audience-actions";
export async function executePublication(
  db: Database,
  id: string,
  connector:
    | Connector
    | ((secret: Record<string, string>, resolve?: MediaResolver) => Connector),
  vault: Vault,
  storage?: PrivateStorage,
  source?: AudienceActions,
) {
  const job = await one(
    db,
    "SELECT * FROM custom_dim.publication_jobs WHERE id=$1",
    [id],
  );
  if (!job || !["queued", "retry"].includes(job.status))
    return { skipped: true };
  let actor;
  try {
    actor = await loadActor(
      db,
      job.requested_by,
      job.organization_id,
      job.requested_aal || "aal1",
      randomUUID(),
    );
  } catch {
    await db.query(
      "UPDATE custom_dim.publication_jobs SET status='blocked',last_error='MEMBERSHIP_REVOKED' WHERE id=$1",
      [id],
    );
    return { blocked: true };
  }
  let claimed = false;
  try {
    await scoped(db, actor, async (tx) => {
      const lock = await one(
        tx,
        "SELECT * FROM custom_dim.publication_jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!["queued", "retry"].includes(lock.status)) return;
      if (new Date(lock.scheduled_at) > new Date()) return;
      await publicationGuard(tx, actor, lock);
      await tx.query(
        "UPDATE custom_dim.publication_jobs SET status='publishing',lease_until=now()+interval '2 minutes',attempt_count=attempt_count+1 WHERE id=$1",
        [id],
      );
      claimed = true;
    });
    if (!claimed) return { skipped: true };
    const result = await scoped(db, actor, async (tx) => {
      // Lock identity while doing the final authorization and outbound request. Suspension waits for this in-flight request.
      await tx.query(
        "SELECT i.id FROM custom_dim.influencers i JOIN custom_dim.social_accounts a ON a.influencer_id=i.id WHERE a.id=$1 FOR SHARE OF i",
        [job.social_account_id],
      );
      const latest = await one(
        tx,
        "SELECT * FROM custom_dim.publication_jobs WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (latest.status !== "publishing") return { skipped: true };
      const { version, account, integration } = await publicationGuard(
        tx,
        actor,
        latest,
      );
      const execution = await one(
        tx,
        "SELECT e.*,b.tenant_id,b.project_id,b.persona_id FROM custom_dim.audience_execution_requests e JOIN custom_dim.audience_bindings b ON b.id=e.binding_id WHERE e.content_id=$1",
        [version.content_id],
      );
      const confirmSource = async () => {
        if (execution) {
          demand(
            source,
            "AUDIENCE_NOT_CONFIGURED",
            "Publicação exige confirmar a aprovação vigente na origem",
            503,
          );
          const binding = {
            tenant_id: execution.tenant_id,
            project_id: execution.project_id,
            persona_id: execution.persona_id,
          };
          let approved;
          try {
            approved = validateAudienceAction(
              await source.get(
                job.organization_id,
                binding,
                execution.action_id,
              ),
              binding,
            );
          } catch (error) {
            if (error instanceof AppError && error.status >= 500)
              throw new ProviderFailure(
                "retry",
                "AUDIENCE_READBACK_UNAVAILABLE",
                30,
              );
            throw error;
          }
          demand(
            approved.actionHash === execution.action_hash,
            "AUDIENCE_ACTION_CHANGED",
            "A aprovação da origem mudou",
            409,
          );
        }
      };
      const secret = await vault.get(integration.secret_ref);
      const transport =
        typeof connector === "function"
          ? connector(
              secret,
              storage?.download
                ? (assetId) => loadVerifiedMedia(tx, actor, assetId, storage)
                : undefined,
            )
          : connector;
      const beforeSend = async () => {
        await confirmSource();
        const currentActor = await loadActor(
          tx,
          job.requested_by,
          job.organization_id,
          job.requested_aal || "aal1",
          randomUUID(),
        );
        await publicationGuard(tx, currentActor, latest);
      };
      await beforeSend();
      const response = await transport.publish({
        token: secret.token,
        destination: account.external_id,
        text: version.body_text,
        idempotencyKey: job.idempotency_key,
        payload: {
          mediaAssetIds: version.body.asset_ids || [],
          title: version.body.title,
          subject: version.body.subject,
          body: version.body,
        },
        beforeSend,
      });
      await insert(tx, "published_posts", {
        organization_id: job.organization_id,
        job_id: id,
        external_post_id: response.externalId,
        external_url: response.url,
        published_at: new Date().toISOString(),
        state: "published",
      });
      await insert(tx, "publication_attempts", {
        organization_id: job.organization_id,
        job_id: id,
        outcome: "success",
        provider_response_ref: response.externalId,
      });
      await tx.query(
        "UPDATE custom_dim.publication_jobs SET status='published',lease_until=NULL,last_error=NULL WHERE id=$1",
        [id],
      );
      await audit(tx, actor, "published", "publication_jobs", id, {
        external_id: response.externalId,
      });
      return response;
    });
    return result;
  } catch (error) {
    const kind =
      error instanceof ProviderFailure
        ? error.kind
        : error instanceof AppError
          ? "permanent"
          : claimed
            ? "uncertain"
            : "permanent";
    const code =
      error instanceof ProviderFailure || error instanceof AppError
        ? error.code
        : "PUBLISH_UNCERTAIN";
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE custom_dim.publication_jobs SET status=$1,last_error=$2,lease_until=NULL WHERE id=$3",
        [
          kind === "retry"
            ? "retry"
            : kind === "uncertain"
              ? "uncertain"
              : "blocked",
          code,
          id,
        ],
      );
      await insert(tx, "publication_attempts", {
        organization_id: job.organization_id,
        job_id: id,
        outcome: kind,
        error_code: code,
      });
    });
    if (kind === "retry") throw error;
    return { status: kind === "uncertain" ? "uncertain" : "blocked", code };
  }
}
