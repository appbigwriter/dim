import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { uuid } from "../../../packages/contracts/src/index";
import { type Database } from "../../../packages/db/src/index";
import {
  configureRiskPolicy,
  reviewFacts,
  riskPolicyInput,
  factReviewInput,
} from "../../../packages/core/src/factual";
import {
  authorize,
  resource,
  scoped,
} from "../../../packages/core/src/security";
import { one } from "../../../packages/db/src/index";
export function factualRoutes(
  app: FastifyInstance,
  opts: { db: Database },
  auth: (r: FastifyRequest) => Promise<void>,
) {
  app.get("/api/v1/settings/risk-policy", { preHandler: auth }, (req) =>
    scoped(opts.db, (req as any).actor, async (tx) => {
      const actor = (req as any).actor;
      authorize(actor, "security.read");
      const policy = await one(
        tx,
        "SELECT version,conditions FROM custom_dim.approval_policies WHERE organization_id=$1 AND resource_type='content' AND enabled=true ORDER BY version DESC LIMIT 1",
        [actor.organizationId],
      );
      return {
        version: policy?.version,
        risk: policy?.conditions.risk || null,
      };
    }),
  );
  app.get(
    "/api/v1/content-versions/:id/fact-review",
    { preHandler: auth, schema: { params: z.object({ id: uuid }) } },
    (req) =>
      scoped(opts.db, (req as any).actor, async (tx) => {
        const actor = (req as any).actor;
        const version = await resource(
          tx,
          "content_versions",
          uuid.parse((req.params as any).id),
          actor,
        );
        const content = await resource(
          tx,
          "content_items",
          version.content_id,
          actor,
        );
        authorize(actor, "editorial.read", {
          influencerId: content.influencer_id,
        });
        return {
          data: (
            await tx.query(
              "SELECT id,passed,payload_hash,policy_version,reviewer_id,evidence,findings,created_at FROM custom_dim.content_verifications WHERE content_version_id=$1 ORDER BY created_at DESC LIMIT 30",
              [version.id],
            )
          ).rows,
        };
      }),
  );
  app.post(
    "/api/v1/settings/risk-policy",
    { preHandler: auth, schema: { body: riskPolicyInput } },
    async (req) =>
      opts.db.transaction((tx) =>
        configureRiskPolicy(tx, (req as any).actor, req.body),
      ),
  );
  app.post(
    "/api/v1/content-versions/:id/fact-review",
    {
      preHandler: auth,
      schema: { body: factReviewInput, params: z.object({ id: uuid }) },
    },
    async (req) =>
      reviewFacts(
        opts.db,
        (req as any).actor,
        uuid.parse((req.params as any).id),
        req.body,
      ),
  );
}
