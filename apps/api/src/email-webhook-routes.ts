import type { FastifyInstance } from "fastify";
import { demand, uuid } from "../../../packages/contracts/src/index";
import type { Database } from "../../../packages/db/src/index";
import type { Vault } from "../../../packages/connectors/src/index";
import {
  emailDeliveryFacts,
  ingestEmailWebhook,
} from "../../../packages/core/src/email-webhooks";
import type { CommandRoute } from "./completion-routes";
export function emailWebhookRoutes(
  app: FastifyInstance,
  route: CommandRoute,
  opts: { db: Database; vault?: Vault },
) {
  app.post(
    "/api/v1/email/webhooks/:accountId",
    { bodyLimit: 1048576 },
    async (request) => {
      demand(
        opts.vault,
        "EMAIL_WEBHOOK_DISABLED",
        "Configure cofre e webhook Resend",
        503,
      );
      const raw = (request as any).rawBody;
      demand(
        Buffer.isBuffer(raw),
        "EMAIL_RAW_BODY_REQUIRED",
        "Assinatura exige corpo original",
        400,
      );
      return ingestEmailWebhook(
        opts.db,
        uuid.parse((request.params as any).accountId),
        raw,
        request.headers,
        opts.vault,
      );
    },
  );
  route(
    "GET",
    "/influencers/:id/email/metrics",
    undefined,
    (db, actor, request) =>
      emailDeliveryFacts(db, actor, uuid.parse(request.params.id)),
  );
}
