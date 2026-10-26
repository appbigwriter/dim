import { z } from "zod";
import {
  uuid,
  demand,
  type Actor,
} from "../../../packages/contracts/src/index";
import type { DB } from "../../../packages/db/src/index";
import { authorize, resource } from "../../../packages/core/src/security";
import { operation } from "../../../packages/core/src/editorial";
import { workflowNames } from "../../../packages/core/src/workflow-runtime";
import type { CommandRoute } from "./completion-routes";
async function access(db: DB, actor: Actor, kind: string, subject: string) {
  if (kind.startsWith("identity.")) {
    await resource(db, "influencers", subject, actor);
    authorize(
      actor,
      kind === "identity.audit" ? "identity.read" : "identity.write",
      { influencerId: subject },
    );
  } else if (kind === "content.approve") {
    const c = await resource(db, "content_items", subject, actor);
    authorize(actor, "editorial.write", { influencerId: c.influencer_id });
  } else if (kind === "social.metrics") {
    const a = await resource(db, "social_accounts", subject, actor);
    authorize(actor, "publication.read", {
      influencerId: a.influencer_id,
      accountId: a.id,
    });
  } else if (kind === "campaign.track") {
    await resource(db, "campaigns", subject, actor);
    authorize(actor, "commercial.read");
  } else {
    demand(
      kind === "security.monitor" && subject === actor.organizationId,
      "WORKFLOW_SCOPE",
      "Workflow fora do escopo",
      403,
    );
    authorize(actor, "security.read");
  }
}
export function workflowRoutes(route: CommandRoute) {
  route(
    "POST",
    "/workflows",
    z
      .object({
        workflow: z.enum(workflowNames),
        subject_id: uuid,
        reason: z.string().min(1).max(2000).optional(),
      })
      .strict(),
    async (db, actor, r) => {
      await access(db, actor, r.body.workflow, r.body.subject_id);
      return operation(
        db,
        actor,
        r.body.workflow,
        r.body.subject_id,
        { reason: r.body.reason },
        String(r.headers["idempotency-key"] || ""),
      );
    },
  );
  route("GET", "/workflows/:id", undefined, async (db, actor, r) => {
    const job = await resource(
      db,
      "operation_jobs",
      uuid.parse(r.params.id),
      actor,
    );
    demand(
      workflowNames.includes(job.job_type),
      "WORKFLOW_TYPE",
      "Use o módulo específico desta operação",
      403,
    );
    await access(db, actor, job.job_type, job.subject_id);
    return {
      id: job.id,
      workflow: job.job_type,
      status: job.status,
      result: job.result,
      last_error: job.last_error,
      created_at: job.created_at,
    };
  });
}
