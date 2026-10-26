import { randomUUID } from "node:crypto";
import { demand, type Actor } from "../../contracts/src/index";
import { one, insert, type DB, type Database } from "../../db/src/index";
import type { Vault } from "../../connectors/src/index";
import { loadActor } from "./access";
import { authorize, resource, scoped, audit, event, member } from "./security";
import { activationBlockers, transition } from "./identity";
import { onboardingCodes, onboardingChecklist } from "./completion";
import { publicationGuard, verifyContent } from "./editorial";
export const workflowNames = [
  "identity.onboard",
  "identity.offboard",
  "identity.audit",
  "content.approve",
  "social.metrics",
  "campaign.track",
  "security.monitor",
] as const;
async function ensureSession(db: DB, actor: Actor, identity: any) {
  let session = await one(
    db,
    "SELECT * FROM custom_dim.onboarding_sessions WHERE organization_id=$1 AND influencer_id=$2 ORDER BY created_at DESC LIMIT 1",
    [actor.organizationId, identity.id],
  );
  if (!session)
    session = await insert(db, "onboarding_sessions", {
      organization_id: actor.organizationId,
      influencer_id: identity.id,
      initiated_by: actor.userId,
    });
  for (const code of onboardingCodes)
    await db.query(
      "INSERT INTO custom_dim.onboarding_steps(organization_id,session_id,step_code) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [actor.organizationId, session.id, code],
    );
  return session;
}
async function onboardingTask(
  db: DB,
  actor: Actor,
  sessionId: string,
  code: string,
  assignee: string,
) {
  await member(db, actor, assignee);
  let task = await one(
    db,
    "SELECT * FROM custom_dim.onboarding_tasks WHERE organization_id=$1 AND session_id=$2 AND task_code=$3",
    [actor.organizationId, sessionId, code],
  );
  if (!task)
    task = await insert(db, "onboarding_tasks", {
      organization_id: actor.organizationId,
      session_id: sessionId,
      task_code: code,
      assignee_id: assignee,
      due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
    });
  return task;
}
async function accountTask(
  db: DB,
  actor: Actor,
  account: any,
  code: string,
  assignee: string,
) {
  authorize(actor, "accounts.write", {
    influencerId: account.influencer_id,
    accountId: account.id,
  });
  await member(db, actor, assignee);
  let task = await one(
    db,
    "SELECT * FROM custom_dim.account_provisioning_tasks WHERE organization_id=$1 AND social_account_id=$2 AND task_key=$3",
    [actor.organizationId, account.id, code],
  );
  if (!task)
    task = await insert(db, "account_provisioning_tasks", {
      organization_id: actor.organizationId,
      social_account_id: account.id,
      task_key: code,
      assignee_id: assignee,
    });
  return task;
}
export async function executeWorkflow(db: Database, id: string, _vault?: Vault) {
  const operation = await one(
    db,
    "SELECT * FROM custom_dim.operation_jobs WHERE id=$1",
    [id],
  );
  if (!operation || !workflowNames.includes(operation.job_type))
    return undefined;
  demand(
    ["running", "completed"].includes(operation.status),
    "OPERATION_NOT_RUNNING",
    "Workflow nao esta em execucao",
    409,
  );
  const actor = await loadActor(
    db,
    operation.payload.requested_by,
    operation.organization_id,
    operation.payload.requested_aal || "aal1",
    operation.correlation_id || randomUUID(),
  );
  return scoped(db, actor, async (tx) => {
    await tx.query(
      "SELECT id FROM custom_dim.operation_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    const current = await resource(tx, "operation_jobs", id, actor);
    let subject: any;
    if (operation.job_type.startsWith("identity.")) {
      subject = await resource(tx, "influencers", operation.subject_id, actor);
      authorize(
        actor,
        operation.job_type === "identity.audit"
          ? "identity.read"
          : "identity.write",
        { influencerId: subject.id },
      );
      authorize(actor, "governance.read", { influencerId: subject.id });
      await tx.query(
        "SELECT id FROM custom_dim.influencers WHERE id=$1 FOR UPDATE",
        [subject.id],
      );
    } else if (operation.job_type === "content.approve") {
      subject = await resource(
        tx,
        "content_items",
        operation.payload.content_id || operation.subject_id,
        actor,
      );
      authorize(actor, "editorial.write", {
        influencerId: subject.influencer_id,
      });
    } else if (operation.job_type === "social.metrics") {
      subject = await resource(
        tx,
        "social_accounts",
        operation.payload.social_account_id || operation.subject_id,
        actor,
      );
      authorize(actor, "publication.read", {
        influencerId: subject.influencer_id,
        accountId: subject.id,
      });
      authorize(actor, "accounts.read", {
        influencerId: subject.influencer_id,
        accountId: subject.id,
      });
    } else if (operation.job_type === "campaign.track") {
      subject = await resource(
        tx,
        "campaigns",
        operation.payload.campaign_id || operation.subject_id,
        actor,
      );
      authorize(actor, "commercial.read");
    } else authorize(actor, "security.read");
    if (current.status === "completed") return current.result;
    demand(
      current.status === "running",
      "OPERATION_ALREADY_CLAIMED",
      "Workflow ja esta em execucao",
      409,
    );
    await tx.query(
      "UPDATE custom_dim.operation_jobs SET status='executing' WHERE id=$1",
      [id],
    );
    let result: any;
    if (operation.job_type === "identity.onboard") {
      demand(
        !["offboarding", "archived"].includes(subject.status),
        "IDENTITY_OFFBOARDING",
        "Identidade em encerramento",
        409,
      );
      await member(tx, actor, subject.owner_user_id);
      const session = await ensureSession(tx, actor, subject),
        tasks = [];
      for (const code of [
        "verify_identity_documentation",
        "verify_rights_evidence",
        "review_persona_at_source",
        "verify_editorial_policy",
        "verify_private_storage",
        "perform_non_destructive_channel_test",
      ]) {
        tasks.push(
          await onboardingTask(
            tx,
            actor,
            session.id,
            code,
            subject.owner_user_id,
          ),
        );
      }
      const accounts = (
        await tx.query(
          "SELECT a.*,p.code AS provider FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE a.influencer_id=$1 ORDER BY a.id",
          [subject.id],
        )
      ).rows;
      const channels = [
        "cms",
        "instagram",
        "facebook",
        "x",
        "whatsapp",
        "telegram",
        "email",
        "youtube",
      ];
      for (const channel of channels) {
        if (!accounts.some((account) => account.provider === channel))
          tasks.push(
            await onboardingTask(
              tx,
              actor,
              session.id,
              channel === "cms"
                ? "audience_blog_provisioning_and_readback"
                : `official_registration_${channel}`,
              subject.owner_user_id,
            ),
          );
      }
      const provisioning = [];
      for (const account of accounts)
        for (const task of [
          "official_registration",
          "ownership_evidence",
          "authorization",
          "non_destructive_test",
        ])
          provisioning.push(
            await accountTask(
              tx,
              actor,
              account,
              task,
              account.recovery_owner_id || subject.owner_user_id,
            ),
          );
      const checklist = await onboardingChecklist(tx, actor, session.id);
      result = {
        workflow: operation.job_type,
        completed: true,
        session_id: session.id,
        identity_status: subject.status,
        tasks: tasks.map((task) => ({
          id: task.id,
          task_code: task.task_code,
          assignee_id: task.assignee_id,
          status: task.status,
          evidence_required: true,
        })),
        account_tasks: provisioning.map((task) => ({
          id: task.id,
          task_key: task.task_key,
          assignee_id: task.assignee_id,
          status: task.status,
          evidence_required: true,
        })),
        blockers: checklist.blockers,
        activation_requires_validated_steps: true,
      };
    } else if (operation.job_type === "identity.offboard") {
      if (!["offboarding", "archived"].includes(subject.status))
        await transition(tx, actor, subject.id, {
          status: "offboarding",
          reason:
            operation.payload.reason ||
            "Encerramento solicitado por workflow autenticado",
          row_version: subject.row_version,
        });
      const accounts = (
          await tx.query(
            "SELECT * FROM custom_dim.social_accounts WHERE influencer_id=$1 ORDER BY id",
            [subject.id],
          )
        ).rows,
        tasks = [];
      for (const account of accounts) {
        for (const key of [
          "official_provider_revocation",
          "ownership_transfer_confirmation",
          "vault_credential_rotation_evidence",
        ])
          tasks.push(
            await accountTask(
              tx,
              actor,
              account,
              key,
              account.recovery_owner_id ||
                subject.owner_user_id ||
                actor.userId,
            ),
          );
      }
      await tx.query(
        "UPDATE custom_dim.account_integrations SET status='revoked' WHERE organization_id=$1 AND social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$2)",
        [actor.organizationId, subject.id],
      );
      await tx.query(
        "UPDATE custom_dim.social_accounts SET integration_status='revoked',account_status='suspended' WHERE organization_id=$1 AND influencer_id=$2",
        [actor.organizationId, subject.id],
      );
      await tx.query(
        "UPDATE custom_dim.agent_assignments SET enabled=false WHERE organization_id=$1 AND influencer_id=$2",
        [actor.organizationId, subject.id],
      );
      await tx.query(
        "UPDATE custom_dim.publication_jobs SET status='cancelled',last_error='IDENTITY_OFFBOARDED' WHERE organization_id=$1 AND status IN('queued','retry') AND social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$2)",
        [actor.organizationId, subject.id],
      );
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status='cancelled',last_error='IDENTITY_OFFBOARDED' WHERE organization_id=$1 AND status IN('queued','retry') AND (subject_id=$2 OR subject_id IN(SELECT id FROM custom_dim.conversations WHERE influencer_id=$2) OR subject_id IN(SELECT id FROM custom_dim.agent_assignments WHERE influencer_id=$2))",
        [actor.organizationId, subject.id],
      );
      result = {
        workflow: operation.job_type,
        completed: true,
        local_access_revoked: true,
        identity_id: subject.id,
        official_revocation_confirmed: tasks.length === 0,
        official_tasks: tasks.map((task) => ({
          id: task.id,
          account_id: task.social_account_id,
          task_key: task.task_key,
          assignee_id: task.assignee_id,
          status: task.status,
          evidence_required: true,
        })),
        evidence_retained: true,
      };
    } else if (operation.job_type === "identity.audit") {
      result = {
        workflow: operation.job_type,
        completed: true,
        identity_id: subject.id,
        status: subject.status,
        blockers: await activationBlockers(tx, actor, subject),
        accounts: (
          await tx.query(
            "SELECT a.id,a.account_status,a.integration_status,p.code AS channel FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE a.influencer_id=$1 ORDER BY a.id",
            [subject.id],
          )
        ).rows,
      };
    } else if (operation.job_type === "content.approve") {
      await tx.query(
        "SELECT id FROM custom_dim.content_items WHERE id=$1 FOR UPDATE",
        [subject.id],
      );
      const version = await one(
        tx,
        "SELECT * FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 1",
        [subject.id],
      );
      demand(version, "VERSION_REQUIRED", "Crie a versao para revisao", 409);
      const key = `review:${version.id}:${version.payload_hash}`;
      let review = await one(
        tx,
        "SELECT * FROM custom_dim.operation_jobs WHERE organization_id=$1 AND idempotency_key=$2",
        [actor.organizationId, key],
      );
      if (!review)
        review = await insert(tx, "operation_jobs", {
          organization_id: actor.organizationId,
          job_type: "content.review_request",
          subject_id: subject.id,
          status: "pending_human",
          idempotency_key: key,
          payload: {
            requested_by: actor.userId,
            content_id: subject.id,
            content_version_id: version.id,
            payload_hash: version.payload_hash,
            requires_independent_review: true,
          },
        });
      await tx.query(
        "UPDATE custom_dim.content_items SET status='review_required' WHERE id=$1",
        [subject.id],
      );
      result = {
        workflow: operation.job_type,
        completed: true,
        review_job_id: review.id,
        content_id: subject.id,
        content_version_id: version.id,
        payload_hash: version.payload_hash,
        verification: await verifyContent(tx, actor, version.id),
        approved: false,
        requires_independent_review: true,
      };
    } else if (operation.job_type === "social.metrics") {
      const samples = (
        await tx.query(
          "SELECT m.id,m.metric_code,m.metric_value,m.observed_at,m.provenance,p.external_post_id FROM custom_dim.publication_metrics m JOIN custom_dim.published_posts p ON p.id=m.published_post_id JOIN custom_dim.publication_jobs j ON j.id=p.job_id WHERE j.social_account_id=$1 ORDER BY m.observed_at DESC LIMIT 500",
          [subject.id],
        )
      ).rows;
      result = {
        workflow: operation.job_type,
        completed: true,
        account_id: subject.id,
        samples,
        data_status: samples.length ? "observed" : "no_data",
        as_of: new Date().toISOString(),
      };
    } else if (operation.job_type === "campaign.track") {
      const deliverables = (
        await tx.query(
          "SELECT id,influencer_id,content_id,status,due_at,(due_at<now() AND status NOT IN('completed','cancelled','published')) AS overdue FROM custom_dim.campaign_deliverables WHERE campaign_id=$1 ORDER BY due_at NULLS LAST,id",
          [subject.id],
        )
      ).rows;
      const costs = (
          await tx.query(
            "SELECT currency,sum(amount)::text AS amount FROM custom_dim.cost_events WHERE campaign_id=$1 GROUP BY currency",
            [subject.id],
          )
        ).rows,
        revenue = (
          await tx.query(
            "SELECT currency,sum(amount)::text AS amount FROM custom_dim.revenue_events WHERE campaign_id=$1 GROUP BY currency",
            [subject.id],
          )
        ).rows;
      result = {
        workflow: operation.job_type,
        completed: true,
        campaign_id: subject.id,
        campaign_status: subject.status,
        deliverables,
        costs,
        revenue,
        overdue_count: deliverables.filter((deliverable) => deliverable.overdue)
          .length,
      };
    } else {
      const incidents = (
        await tx.query(
          "SELECT id,severity,category,state,opened_at FROM custom_dim.security_incidents WHERE organization_id=$1 AND state<>'resolved' ORDER BY opened_at",
          [actor.organizationId],
        )
      ).rows;
      const expired = (
        await tx.query(
          "SELECT id,social_account_id,expires_at FROM custom_dim.account_integrations WHERE organization_id=$1 AND status='active' AND expires_at<=now()",
          [actor.organizationId],
        )
      ).rows;
      const orphaned = (
        await tx.query(
          "SELECT a.id,a.influencer_id FROM custom_dim.social_accounts a WHERE a.organization_id=$1 AND a.integration_status='connected' AND NOT EXISTS(SELECT 1 FROM custom_dim.account_integrations i WHERE i.social_account_id=a.id AND i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now()))",
          [actor.organizationId],
        )
      ).rows;
      result = {
        workflow: operation.job_type,
        completed: true,
        incidents,
        expired_integrations: expired,
        connected_without_authorization: orphaned,
        observed_at: new Date().toISOString(),
      };
    }
    await tx.query(
      "UPDATE custom_dim.operation_jobs SET status='completed',result=$1 WHERE id=$2",
      [JSON.stringify(result), id],
    );
    await audit(tx, actor, "workflow_completed", "operation_jobs", id, {
      workflow: operation.job_type,
      subject_id: operation.subject_id,
    });
    return result;
  });
}
export async function executePublicationWorkflow(db: Database, id: string) {
  const job = await one(
    db,
    "SELECT * FROM custom_dim.publication_jobs WHERE id=$1",
    [id],
  );
  if (!job) return undefined;
  const origin = await one(
    db,
    "SELECT payload FROM custom_dim.outbox_events WHERE organization_id=$1 AND aggregate_id=$2 AND event_type='social.publish' AND payload->>'requested_by'=$3 ORDER BY occurred_at LIMIT 1",
    [job.organization_id, id, job.requested_by],
  );
  demand(
    origin,
    "PUBLICATION_ORIGIN_REQUIRED",
    "Evento original autenticado necessario",
    409,
  );
  const actor = await loadActor(
    db,
    job.requested_by,
    job.organization_id,
    origin.payload.requested_aal || "aal1",
    randomUUID(),
  );
  return scoped(db, actor, async (tx) => {
    const account = await resource(
      tx,
      "social_accounts",
      job.social_account_id,
      actor,
    );
    authorize(actor, "publication.write", {
      influencerId: account.influencer_id,
      accountId: account.id,
    });
    const current = await one(
      tx,
      "SELECT * FROM custom_dim.publication_jobs WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (["published", "publishing"].includes(current.status))
      return { completed: true, queued: false, status: current.status };
    demand(
      ["queued", "retry"].includes(current.status),
      "PUBLICATION_STATE",
      "Trabalho exige revisao ou reconciliacao; nao reenviar",
      409,
    );
    await publicationGuard(tx, actor, current);
    const pending = await one(
      tx,
      "SELECT id FROM custom_dim.outbox_events WHERE aggregate_id=$1 AND event_type='social.publish' AND processed_at IS NULL",
      [id],
    );
    if (!pending) await event(tx, actor, "social.publish", id, { job_id: id });
    return {
      completed: true,
      queued: true,
      publication_job_id: id,
      status: current.status,
    };
  });
}
