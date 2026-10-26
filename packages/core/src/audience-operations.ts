import { randomUUID } from "node:crypto";
import { AppError, demand, type Actor } from "../../contracts/src/index";
import { validateAudienceAction } from "../../contracts/src/audience-actions";
import type { AudienceActions } from "../../connectors/src/audience-actions";
import {
  TelegramConnector,
  whatsappSend,
  ProviderFailure,
  type Vault,
} from "../../connectors/src/index";
import { templateParameters } from "../../connectors/src/templates";
import { sendEmailReply } from "./email";
import { one, type DB, type Database } from "../../db/src/index";
import { audit, authorize, resource, scoped } from "./security";
import { loadActor } from "./access";
import { verifyContent, operation } from "./editorial";
import { messageGuard } from "./inbox";
import { executionReceipt } from "./audience-execution";

async function guard(db: DB, actor: Actor, execution: any) {
  authorize(actor, "publication.write", {
    influencerId: execution.influencer_id,
    accountId: execution.social_account_id,
  });
  const identity = await resource(
    db,
    "influencers",
    execution.influencer_id,
    actor,
  );
  demand(
    identity.status === "active",
    "IDENTITY_INACTIVE",
    "Identidade não está ativa",
    409,
  );
  const binding = await resource(
    db,
    "audience_bindings",
    execution.binding_id,
    actor,
  );
  demand(
    binding.status === "synced" &&
      binding.current_context_id === execution.context_id,
    "AUDIENCE_ACTION_STALE",
    "Sincronize o contexto vigente",
    409,
  );
  if (execution.automatic)
    demand(
      binding.execution_enabled &&
        binding.executor_user_id === actor.userId &&
        execution.requested_by === actor.userId &&
        !actor.grants.some(
          (g) =>
            g.permission === "*" ||
            g.permission === "approval.write" ||
            g.permission.startsWith("security."),
        ),
      "AUDIENCE_EXECUTOR_DISABLED",
      "Executor alterado ou desativado",
      403,
    );
  const action = validateAudienceAction(execution.action, {
    tenant_id: binding.tenant_id,
    project_id: binding.project_id,
    persona_id: binding.persona_id,
  });
  const version = await resource(
    db,
    "content_versions",
    execution.content_version_id,
    actor,
  );
  demand(
    (
      await one(
        db,
        "SELECT id FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
        [execution.content_id],
      )
    )?.id === version.id,
    "AUDIENCE_ACTION_CHANGED",
    "Versão da ação mudou",
    409,
  );
  demand(
    (await verifyContent(db, actor, version.id)).passed,
    "COMPLIANCE_BLOCKED",
    "Conteúdo da ação bloqueado",
    409,
  );
  const policy = await one(
    db,
    "SELECT * FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
    [actor.organizationId],
  );
  demand(policy, "POLICY_REQUIRED", "Defina política de aprovação", 409);
  const decisions = (
    await db.query(
      "SELECT DISTINCT ON(approver_id) decision FROM custom_dim.content_approvals WHERE content_version_id=$1 AND payload_hash=$2 AND policy_version=$3 ORDER BY approver_id,decided_at DESC,created_at DESC",
      [version.id, version.payload_hash, policy.version],
    )
  ).rows;
  demand(
    decisions.length >= Number(policy.conditions.required_approvals || 1) &&
      decisions.every((d) => d.decision === "approved"),
    "APPROVAL_QUORUM_REQUIRED",
    "Revisão local independente obrigatória",
    409,
  );
  if (action.kind === "message") {
    const conversation = await resource(
      db,
      "conversations",
      action.message!.conversationId,
      actor,
    );
    demand(
      conversation.influencer_id === execution.influencer_id &&
        conversation.social_account_id === action.targetAccountId,
      "AUDIENCE_MESSAGE_SCOPE",
      "Conversa fora da conta e identidade aprovadas",
      403,
    );
    await messageGuard(
      db,
      actor,
      conversation,
      action.message!.purpose,
      action.message!.templateId,
      action.message!.templateParameters || [],
      action.message!.templateComponents,
    );
  } else {
    demand(
      action.kind === "crm_update",
      "AUDIENCE_ACTION_KIND",
      "Ação não operacional",
      422,
    );
    authorize(actor, "inbox.write", { influencerId: execution.influencer_id });
    const contact = await resource(
      db,
      "contacts",
      action.crm!.contactId,
      actor,
    );
    demand(
      contact.status === "active" &&
        (await one(
          db,
          "SELECT id FROM custom_dim.contact_influencers WHERE contact_id=$1 AND influencer_id=$2 AND relationship_status='active'",
          [contact.id, execution.influencer_id],
        )),
      "AUDIENCE_CONTACT_SCOPE",
      "Contato indisponível ou não vinculado",
      403,
    );
  }
  return { action, binding };
}
export async function queueAudienceOperation(
  db: DB,
  actor: Actor,
  execution: any,
) {
  const { action } = await guard(db, actor, execution);
  const job = await operation(
    db,
    actor,
    "audience.execute",
    execution.id,
    {
      execution_id: execution.id,
      requested_by: actor.userId,
      requested_aal: actor.aal,
    },
    `audience:${execution.id}`,
  );
  await db.query(
    "UPDATE custom_dim.operation_jobs SET available_at=$1 WHERE id=$2 AND status='queued'",
    [action.scheduledAt, job.id],
  );
  await db.query(
    "UPDATE custom_dim.audience_execution_requests SET operation_job_id=$1 WHERE id=$2",
    [job.id, execution.id],
  );
  await executionReceipt(db, execution, "scheduled");
  return job;
}
export async function executeAudienceOperation(
  db: Database,
  job: any,
  provider: AudienceActions,
  vault: Vault,
  fetcher: typeof fetch = fetch,
  reserveRate?: (provider: string, accountId: string) => Promise<void>,
) {
  const storedJob = await one(
    db,
    "SELECT * FROM custom_dim.operation_jobs WHERE id=$1 AND organization_id=$2",
    [job.id, job.organization_id],
  );
  demand(
    storedJob?.job_type === "audience.execute",
    "AUDIENCE_OPERATION_SCOPE",
    "Tipo de operação não corresponde ao executor",
    403,
  );
  job = storedJob;
  if (job.status !== "running") return { skipped: true };
  let execution = await one(
    db,
    "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 AND organization_id=$2",
    [job.subject_id, job.organization_id],
  );
  demand(
    execution && execution.operation_job_id === job.id,
    "AUDIENCE_OPERATION_SCOPE",
    "Operação não vinculada",
    403,
  );
  if (["succeeded", "cancelled"].includes(execution.last_status))
    return { skipped: true };
  let mutating = false;
  try {
    const actor = await loadActor(
      db,
      job.payload.requested_by,
      job.organization_id,
      job.payload.requested_aal || "aal1",
      randomUUID(),
    );
    return await scoped(db, actor, async (tx) => {
      // Reload after the lock: another worker may have committed a terminal result while
      // this invocation waited. A stale pre-lock snapshot must never authorize a second send.
      execution = await one(
        tx,
        "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1 FOR UPDATE",
        [execution.id],
      );
      const currentJob = await one(
        tx,
        "SELECT * FROM custom_dim.operation_jobs WHERE id=$1 FOR UPDATE",
        [job.id],
      );
      if (
        !execution ||
        ["succeeded", "cancelled"].includes(execution.last_status) ||
        currentJob?.status !== "running"
      )
        return { skipped: true };
      const { action, binding } = await guard(tx, actor, execution);
      demand(
        new Date(action.scheduledAt).getTime() <= Date.now(),
        "AUDIENCE_NOT_DUE",
        "Ação ainda fora da janela",
        409,
      );
      const beforeSend = async () => {
        const current = validateAudienceAction(
          await provider.get(
            actor.organizationId,
            {
              tenant_id: binding.tenant_id,
              project_id: binding.project_id,
              persona_id: binding.persona_id,
            },
            action.actionId,
          ),
          {
            tenant_id: binding.tenant_id,
            project_id: binding.project_id,
            persona_id: binding.persona_id,
          },
        );
        demand(
          current.actionHash === execution.action_hash,
          "AUDIENCE_ACTION_CHANGED",
          "Aprovação da origem mudou",
          409,
        );
        await guard(
          tx,
          await loadActor(
            tx,
            actor.userId,
            actor.organizationId,
            actor.aal,
            randomUUID(),
          ),
          execution,
        );
        if (action.kind === "message") {
          await reserveRate?.(action.channel, action.targetAccountId!);
          mutating = true;
        }
      };
      let externalId: string | undefined;
      if (action.kind === "crm_update") {
        await beforeSend();
        const patch = action.crm!.patch,
          contactId = action.crm!.contactId;
        await tx.query(
          "SELECT id FROM custom_dim.contacts WHERE id=$1 FOR UPDATE",
          [contactId],
        );
        await guard(tx, actor, execution);
        await tx.query(
          "UPDATE custom_dim.contacts SET display_name=coalesce($1,display_name),locale=coalesce($2,locale) WHERE id=$3",
          [patch.displayName, patch.locale, contactId],
        );
        if (patch.relationshipStatus)
          await tx.query(
            "UPDATE custom_dim.contact_influencers SET relationship_status=$1 WHERE contact_id=$2 AND influencer_id=$3",
            [patch.relationshipStatus, contactId, execution.influencer_id],
          );
        await audit(tx, actor, "audience_crm_updated", "contacts", contactId, {
          execution_id: execution.id,
          fields: Object.keys(patch),
        });
      } else if (action.channel === "email") {
        const result = await sendEmailReply(
          tx,
          actor,
          action.message!.conversationId,
          {
            text: action.content.text,
            purpose: action.message!.purpose,
            email_subject: action.content.title,
          },
          job.id,
          vault,
          fetcher,
          beforeSend,
        );
        externalId = result.externalId;
      } else {
        const account = await resource(
          tx,
          "social_accounts",
          action.targetAccountId!,
          actor,
        );
        const integration = await one(
          tx,
          "SELECT * FROM custom_dim.account_integrations WHERE social_account_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now())",
          [account.id],
        );
        demand(
          integration &&
            integration.secret_ref.startsWith(
              `dim/${actor.organizationId}/${account.id}/`,
            ),
          "VAULT_SCOPE",
          "Conta sem autorização",
          403,
        );
        const secret = await vault.get(integration.secret_ref);
        const conversation = await resource(
          tx,
          "conversations",
          action.message!.conversationId,
          actor,
        );
        if (action.channel === "telegram")
          externalId = (
            await new TelegramConnector().publish({
              token: secret.token,
              destination: conversation.external_thread_id,
              text: action.content.text,
              idempotencyKey: job.id,
              beforeSend,
            })
          ).externalId;
        else {
          const data = await messageGuard(
            tx,
            actor,
            conversation,
            action.message!.purpose,
            action.message!.templateId,
            action.message!.templateParameters || [],
            action.message!.templateComponents,
          );
          await beforeSend();
          const result = await whatsappSend(
            secret.token,
            account.external_id,
            conversation.external_thread_id,
            data.template
              ? {
                  template: {
                    name: data.template.provider_template_id,
                    language: { code: data.template.language },
                    components: templateParameters(
                      data.template,
                      action.message!.templateParameters || [],
                      action.message!.templateComponents,
                    ),
                  },
                }
              : { text: action.content.text },
          );
          if (!result.messages?.[0]?.id)
            throw new ProviderFailure("uncertain", "PROVIDER_RESPONSE");
          externalId = result.messages[0].id;
        }
      }
      if (action.kind === "message")
        await tx.query(
          "INSERT INTO custom_dim.messages(organization_id,conversation_id,direction,body_reference,provider_message_id,status) VALUES($1,$2,'outgoing',$3,$4,'sent')",
          [
            actor.organizationId,
            action.message!.conversationId,
            action.content.text,
            externalId,
          ],
        );
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status='completed',result=$1 WHERE id=$2",
        [JSON.stringify({ completed: true, externalId }), job.id],
      );
      await executionReceipt(
        tx,
        execution,
        "succeeded",
        externalId ? { externalId } : {},
      );
      return { completed: true, externalId };
    });
  } catch (error) {
    const status =
      error instanceof ProviderFailure
        ? error.kind === "retry"
          ? "retry"
          : error.kind === "uncertain"
            ? "uncertain"
            : "blocked"
        : error instanceof AppError && !mutating
          ? "blocked"
          : "uncertain";
    const code =
      error instanceof ProviderFailure || error instanceof AppError
        ? error.code
        : "AUDIENCE_OPERATION_UNCERTAIN";
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status=$1,last_error=$2 WHERE id=$3",
        [status, code, job.id],
      );
      await executionReceipt(
        tx,
        execution,
        status === "retry" ? "scheduled" : status,
        { errorCode: code },
      );
    });
    if (status === "retry") throw error;
    return { status, code };
  }
}
