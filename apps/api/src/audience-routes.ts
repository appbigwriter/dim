import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { demand, uuid } from "../../../packages/contracts/src/index";
import type { AudienceActions } from "../../../packages/connectors/src/audience-actions";
import { one, type Database } from "../../../packages/db/src/index";
import {
  resource,
  authorize,
  scoped,
} from "../../../packages/core/src/security";
import {
  configureAudienceExecutor,
  importAudienceAction,
  scheduleAudienceExecution,
} from "../../../packages/core/src/audience-execution";
import type { CommandRoute } from "./completion-routes";
const authenticatedSchema = {
  tags: ["audience"],
  security: [{ bearer: [] }],
  headers: z.object({ "x-organization-id": uuid }).passthrough(),
  params: z.object({ id: uuid }),
};

export function audienceRoutes(
  app: FastifyInstance,
  route: CommandRoute,
  opts: { db: Database; audienceActions?: AudienceActions },
  auth: (request: FastifyRequest) => Promise<void>,
) {
  app.post(
    "/api/v1/influencers/:id/audience/executor",
    {
      preHandler: auth,
      schema: {
        ...authenticatedSchema,
        body: z
          .object({ enabled: z.boolean(), executor_user_id: uuid.optional() })
          .strict(),
      },
    },
    async (req) => {
      const input = req.body as { enabled: boolean; executor_user_id?: string };
      return configureAudienceExecutor(
        opts.db,
        (req as any).actor,
        uuid.parse((req.params as any).id),
        input.enabled,
        input.executor_user_id,
      );
    },
  );
  route(
    "GET",
    "/influencers/:id/audience/executions",
    undefined,
    async (db, actor, req) => {
      const id = uuid.parse(req.params.id);
      await resource(db, "influencers", id, actor);
      authorize(actor, "editorial.read", { influencerId: id });
      const executions = (
        await db.query(
          "SELECT id,automatic,action_id,action_hash,content_id,content_version_id,social_account_id,last_status,created_at FROM custom_dim.audience_execution_requests WHERE influencer_id=$1 ORDER BY created_at DESC LIMIT 100",
          [id],
        )
      ).rows;
      return { executions };
    },
  );
  route(
    "POST",
    "/audience/executions/:id/schedule",
    z.object({}).strict(),
    (db, actor, req) =>
      scheduleAudienceExecution(db, actor, uuid.parse(req.params.id)),
  );
  app.get(
    "/api/v1/influencers/:id/audience/actions",
    { preHandler: auth, schema: authenticatedSchema },
    async (req) => {
      demand(
        opts.audienceActions,
        "AUDIENCE_NOT_CONFIGURED",
        "Configure API de ações Audience no cofre",
        503,
      );
      const actor = (req as any).actor;
      const id = uuid.parse((req.params as any).id);
      const binding = await scoped(opts.db, actor, async (db) => {
        await resource(db, "influencers", id, actor);
        authorize(actor, "editorial.read", { influencerId: id });
        const row = await one(
          db,
          "SELECT * FROM custom_dim.audience_bindings WHERE influencer_id=$1",
          [id],
        );
        demand(
          row,
          "AUDIENCE_BINDING_REQUIRED",
          "Vincule o projeto Audience",
          409,
        );
        return {
          tenant_id: row.tenant_id,
          project_id: row.project_id,
          persona_id: row.persona_id,
        };
      });
      return {
        actions: await opts.audienceActions.list(actor.organizationId, binding),
      };
    },
  );
  app.post(
    "/api/v1/influencers/:id/audience/import-action",
    {
      preHandler: auth,
      schema: {
        ...authenticatedSchema,
        body: z.object({ action_id: z.string().min(1).max(180) }).strict(),
      },
    },
    async (req) => {
      demand(
        opts.audienceActions,
        "AUDIENCE_NOT_CONFIGURED",
        "Configure API de ações Audience no cofre",
        503,
      );
      return importAudienceAction(
        opts.db,
        (req as any).actor,
        uuid.parse((req.params as any).id),
        (req.body as any).action_id,
        opts.audienceActions,
      );
    },
  );
}
