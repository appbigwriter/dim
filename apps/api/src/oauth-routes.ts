import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { demand, uuid } from "../../../packages/contracts/src/index";
import type { Database } from "../../../packages/db/src/index";
import type { Vault } from "../../../packages/connectors/src/index";
import type { OAuthProvidersConfig } from "../../../packages/connectors/src/oauth-multichannel";
import {
  beginChannelOAuth,
  channelOAuthChoices,
  finishChannelOAuth,
  selectChannelOAuth,
} from "../../../packages/core/src/oauth";
import type { CommandRoute } from "./completion-routes";
export function oauthRoutes(
  app: FastifyInstance,
  route: CommandRoute,
  opts: { db: Database; vault?: Vault; oauth?: OAuthProvidersConfig },
  _auth?: (req: FastifyRequest) => Promise<void>,
) {
  const enabled = () => {
    demand(
      opts.vault && opts.oauth,
      "OAUTH_NOT_CONFIGURED",
      "Configure aplicativo OAuth e cofre",
      503,
    );
    return { vault: opts.vault, config: opts.oauth };
  };
  route(
    "POST",
    "/accounts/:id/connect/start",
    z.object({}).strict(),
    (db, actor, request) => {
      const { vault, config } = enabled();
      return beginChannelOAuth(
        db,
        actor,
        uuid.parse(request.params.id),
        vault,
        config,
      );
    },
  );
  route(
    "GET",
    "/accounts/:id/connect/:operation/choices",
    undefined,
    (db, actor, request) => {
      const { vault } = enabled();
      return channelOAuthChoices(
        db,
        actor,
        uuid.parse(request.params.id),
        uuid.parse(request.params.operation),
        vault,
      );
    },
  );
  route(
    "POST",
    "/accounts/:id/connect/:operation/select",
    z.object({ external_id: z.string().min(1).max(180) }).strict(),
    (db, actor, request) => {
      const { vault } = enabled();
      return selectChannelOAuth(
        db,
        actor,
        uuid.parse(request.params.id),
        uuid.parse(request.params.operation),
        request.body.external_id,
        vault,
      );
    },
  );
  app.get(
    "/api/v1/oauth/callback/:provider",
    {
      logLevel: "silent",
      schema: {
        params: z.object({ provider: z.enum(["x", "meta", "google"]) }),
        querystring: z
          .object({
            state: z.string().min(32).max(128),
            code: z.string().min(1).max(4096),
          })
          .passthrough(),
      },
    },
    async (request, reply) => {
      const { vault, config } = enabled();
      reply
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer");
      const query = request.query as { state: string; code: string };
      return finishChannelOAuth(
        opts.db,
        (request.params as { provider: "x" | "meta" | "google" }).provider,
        query.state,
        query.code,
        vault,
        config,
      );
    },
  );
}
