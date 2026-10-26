import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { demand, uuid } from "../../../packages/contracts/src/index";
import { type Database } from "../../../packages/db/src/index";
import { authorize } from "../../../packages/core/src/security";
import {
  retentionPolicy,
  saveRetentionPolicy,
  readRetentionPolicy,
  prepareRetention,
  reviewRetention,
  purgeReviewInput,
  executeRetention,
  type ErasureProvider,
} from "../../../packages/core/src/retention";
import type { CommandRoute } from "./completion-routes";
export function registerRetentionRoutes(
  app: FastifyInstance,
  route: CommandRoute,
  opts: { db: Database; erasure?: ErasureProvider },
  auth: (req: FastifyRequest) => Promise<void>,
) {
  route("GET", "/privacy/requests", undefined, async (db, a) => {
    authorize(a, "security.write");
    return {
      requests: (
        await db.query(
          "SELECT id,subject_id,status,payload,result,created_at FROM custom_dim.operation_jobs WHERE organization_id=$1 AND job_type='privacy.request' ORDER BY created_at DESC LIMIT 100",
          [a.organizationId],
        )
      ).rows,
    };
  });
  route("GET", "/privacy/retention-policy", undefined, (db, a) =>
    readRetentionPolicy(db, a),
  );
  app.post(
    "/api/v1/privacy/retention-policy",
    { preHandler: auth, schema: { body: retentionPolicy } },
    (req) =>
      opts.db.transaction((tx) =>
        saveRetentionPolicy(tx, (req as any).actor, req.body),
      ),
  );
  route(
    "POST",
    "/privacy/requests/:id/external-plan",
    z.object({}).strict(),
    (db, a, r) => prepareRetention(db, a, uuid.parse(r.params.id)),
  );
  route(
    "POST",
    "/privacy/external-jobs/:id/review",
    purgeReviewInput,
    (db, a, r) => reviewRetention(db, a, uuid.parse(r.params.id), r.body),
  );
  route("GET", "/privacy/external-jobs", undefined, async (db, a) => {
    authorize(a, "security.write");
    return {
      jobs: (
        await db.query(
          "SELECT id,subject_id,status,payload,result,last_error,created_at FROM custom_dim.operation_jobs WHERE organization_id=$1 AND job_type='privacy.external_erasure' ORDER BY created_at DESC LIMIT 100",
          [a.organizationId],
        )
      ).rows,
    };
  });
  app.post(
    "/api/v1/privacy/external-jobs/:id/execute",
    {
      preHandler: auth,
      schema: {
        body: z
          .object({
            dry_run: z.boolean().default(true),
            expected_receipt_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          })
          .strict(),
      },
    },
    async (req) => {
      demand(
        opts.erasure,
        "ERASURE_NOT_CONFIGURED",
        "Configure Vault e os destinos de exclusao",
        503,
      );
      return executeRetention(
        opts.db,
        (req as any).actor,
        uuid.parse((req.params as any).id),
        req.body,
        opts.erasure,
      );
    },
  );
}
