import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { randomUUID, createHash } from "node:crypto";
import {
  AppError,
  demand,
  pageInput,
  uuid,
  json,
  text,
  transitionInput,
  identityInput,
  versionInput,
  approvalInput,
  publicationInput,
  type Actor,
} from "../../../packages/contracts/src/index";
import {
  insert,
  one,
  type Database,
  type DB,
} from "../../../packages/db/src/index";
import { accessCommand } from "../../../packages/core/src/access";
import {
  resources,
  readResources,
  createResource,
} from "../../../packages/core/src/resources";
import {
  audit,
  authorize,
  member,
  resource,
  scoped,
  visible,
} from "../../../packages/core/src/security";
import {
  transition,
  patchIdentity,
  persona,
  saveOnboarding,
  revokeConsent,
  rightsBlockers,
  activationBlockers,
  assignmentInput,
} from "../../../packages/core/src/identity";
import {
  approve,
  contentVersion,
  schedule,
  cancelPublication,
  verifyContent,
  operation,
} from "../../../packages/core/src/editorial";
import { list, analytics } from "../../../packages/core/src/queries";
import { handoff, ingest, sendMessage } from "../../../packages/core/src/inbox";
import {
  TelegramConnector,
  whatsappHealth,
  verifyWebhook,
  type Vault,
} from "../../../packages/connectors/src/index";
import { beginX, finishX } from "../../../packages/connectors/src/oauth";
import {
  uploadPrivate,
  type PrivateStorage,
} from "../../../packages/connectors/src/storage";
import { executeAutomation } from "../../../packages/core/src/automation";
import { sameSecret } from "../../../packages/connectors/src/index";
import { completionRoutes } from "./completion-routes";
import type { Inviter } from "../../../packages/core/src/invitations";
type Options = {
  db: Database;
  authenticate: (
    token: string,
    org: string,
    correlationId: string,
  ) => Promise<Actor>;
  session?: (token: string) => Promise<{ userId: string; aal: string; emailVerified?: boolean }>;
  invite?: Inviter;
  vault?: Vault;
  storage?: PrivateStorage;
  scan?: (data: Buffer) => Promise<void>;
  dependencies?: () => Promise<any>;
  logger?: boolean;
};
type Request = FastifyRequest & { actor: Actor; rawBody: Buffer };
const row = z.record(z.string(), z.any());
const error = z.object({
  code: z.string(),
  message: z.string(),
  details: z.any().optional(),
  correlation_id: z.string(),
});
export async function buildApp(opts: Options) {
  const app = Fastify({
    logger: opts.logger
      ? {
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          serializers: {
            req: (r: any) => ({ method: r.method, path: r.url?.split("?")[0] }),
          },
        }
      : false,
    bodyLimit: 8 * 1024 * 1024,
    genReqId: () => randomUUID(),
    requestTimeout: 20000,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const metric = {
    requests: 0,
    errors: 0,
    sum: 0,
    buckets: new Map([50, 100, 300, 800, 1500, 5000].map((n) => [n, 0])),
  };
  app.addHook("onResponse", async (_req, reply) => {
    metric.requests++;
    if (reply.statusCode >= 500) metric.errors++;
    metric.sum += reply.elapsedTime;
    for (const [bound, count] of metric.buckets)
      if (reply.elapsedTime <= bound) metric.buckets.set(bound, count + 1);
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Organization-Id",
      "Idempotency-Key",
    ],
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (req) =>
      req.headers.authorization
        ? createHash("sha256").update(req.headers.authorization).digest("hex")
        : req.ip,
  });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "DIM API", version: "0.1.0" },
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      },
    },
    transform: jsonSchemaTransform,
  });
  app.decorateRequest("actor", null);
  app.decorateRequest("rawBody", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as Request).rawBody = body as Buffer;
      try {
        done(null, JSON.parse(body.toString()));
      } catch {
        done(new AppError(400, "INVALID_JSON", "JSON inválido"));
      }
    },
  );
  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Correlation-Id", req.id);
    reply.header("Cache-Control", "no-store");
  });
  app.setErrorHandler((err: any, req, reply) => {
    const status =
      err instanceof AppError
        ? err.status
        : err.validation || err instanceof z.ZodError
          ? 400
          : err.code === "23505"
            ? 409
            : err.code === "23503" || err.code === "23514"
              ? 422
              : err.statusCode === 429
                ? 429
                : 500;
    if (status === 500)
      app.log.error(
        { correlation_id: req.id, code: err.code || "INTERNAL_ERROR" },
        "request_failed",
      );
    reply.code(status).send({
      code:
        err instanceof AppError
          ? err.code
          : status === 409
            ? "CONFLICT"
            : status === 400
              ? "VALIDATION_ERROR"
              : status === 422
                ? "CONSTRAINT_VIOLATION"
                : status === 429
                  ? "RATE_LIMIT"
                  : "INTERNAL_ERROR",
      message:
        err instanceof AppError
          ? err.message
          : status === 500
            ? "Falha interna; informe o correlation ID"
            : "Requisição inválida",
      details:
        err instanceof z.ZodError
          ? err.issues.map((i) => ({ path: i.path, message: i.message }))
          : undefined,
      correlation_id: req.id,
    });
  });
  const auth = async (req: FastifyRequest) => {
    const r = req as Request;
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    demand(
      req.headers.authorization?.startsWith("Bearer ") && token,
      "UNAUTHENTICATED",
      "Entre para continuar",
      401,
    );
    const org = uuid.parse(req.headers["x-organization-id"]);
    r.actor = await opts.authenticate(token, org, req.id);
  };
  const schema = (tag: string, body?: any, response: any = row) => ({
    tags: [tag],
    security: [{ bearer: [] }],
    ...(body ? { body } : {}),
    response: {
      200: response,
      400: error,
      401: error,
      403: error,
      404: error,
      409: error,
      422: error,
      429: error,
      500: error,
      503: error,
    },
  });
  function route(
    method: "GET" | "POST" | "PATCH",
    path: string,
    body: any,
    fn: (db: DB, a: Actor, r: Request) => Promise<any>,
    response: any = row,
  ) {
    const paramNames = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    app.route({
      method,
      url: `/api/v1${path}`,
      preHandler: auth,
      schema: {
        ...schema(path.split("/")[1], body, response),
        ...(paramNames.length
          ? {
              params: z.object(
                Object.fromEntries(paramNames.map((name) => [name, uuid])),
              ),
            }
          : {}),
      },
      handler: async (r) =>
        scoped(opts.db, (r as Request).actor, (tx) =>
          fn(tx, (r as Request).actor, r as Request),
        ),
    });
  }
  app.get("/health", async () => ({ status: "alive", service: "dim-api" }));
  app.get("/metrics", async (req, reply) => {
    demand(
      sameSecret(
        String(req.headers.authorization || "").replace(/^Bearer /, ""),
        process.env.METRICS_TOKEN || "",
      ),
      "UNAUTHENTICATED",
      "Monitor não autenticado",
      401,
    );
    const counts = (
      await opts.db.query(
        "SELECT status,count(*)::int AS n FROM custom_dim.publication_jobs WHERE status IN('uncertain','failed','queued','retry') GROUP BY status",
      )
    ).rows;
    reply.type("text/plain; version=0.0.4");
    return (
      [
        `dim_http_requests_total ${metric.requests}`,
        `dim_http_errors_total ${metric.errors}`,
        `dim_http_duration_ms_sum ${metric.sum}`,
        `dim_http_duration_ms_count ${metric.requests}`,
        ...[...metric.buckets].map(
          ([bound, count]) =>
            `dim_http_duration_ms_bucket{le="${bound}"} ${count}`,
        ),
        `dim_http_duration_ms_bucket{le="+Inf"} ${metric.requests}`,
        ...counts.map((c) => `dim_publication_${c.status} ${c.n}`),
      ].join("\n") + "\n"
    );
  });
  app.get("/health/live", async () => ({ status: "alive" }));
  app.get("/health/ready", async (_r, reply) => {
    try {
      await opts.db.query("SELECT 1");
      const deps = await opts.dependencies?.();
      if (deps && !deps.ready)
        return reply.code(503).send({ status: "not_ready" });
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
  app.get("/health/dependencies", { preHandler: auth }, async (r) => {
    authorize((r as Request).actor, "security.read");
    return opts.dependencies
      ? opts.dependencies()
      : { database: "configured", redis: "not_configured" };
  });
  app.get("/api/v1/session", async (req) => {
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    demand(token && opts.session, "UNAUTHENTICATED", "Sessão necessária", 401);
    const session = await opts.session(token);
    const organizations = (
      await opts.db.query(
        "SELECT o.id,o.name,o.slug FROM custom_dim.organizations o JOIN custom_dim.organization_members m ON m.organization_id=o.id WHERE m.user_id=$1 AND m.status='active' AND o.status='active'",
        [session.userId],
      )
    ).rows;
    return { ...session, organizations };
  });
  app.post("/api/v1/automation/execute", async (req) => {
    demand(
      sameSecret(
        String(req.headers["x-dim-service-token"] || ""),
        process.env.N8N_SERVICE_TOKEN || "",
      ),
      "UNAUTHENTICATED",
      "Serviço não autenticado",
      401,
    );
    demand(opts.vault, "VAULT_UNAVAILABLE", "Cofre necessário", 503);
    const input = z.object({ operation_id: uuid }).strict().parse(req.body);
    return executeAutomation(opts.db, input.operation_id, opts.vault);
  });
  route("GET", "/me", undefined, async (db, a) => {
    await audit(db, a, "session_verified", "organizations", a.organizationId, {
      aal: a.aal,
    });
    return {
      user_id: a.userId,
      organization_id: a.organizationId,
      aal: a.aal,
      grants: a.grants,
    };
  });
  route("GET", "/forms", undefined, async (_db, a) => ({
    resources: Object.fromEntries(
      Object.entries(resources).map(([key, def]) => [
        key,
        {
          schema: z.toJSONSchema(def.schema),
          can_create: a.grants.some(
            (g) =>
              g.permission === "*" ||
              g.permission === `${def.permission}.write`,
          ),
        },
      ]),
    ),
  }));
  route(
    "POST",
    "/storage/upload",
    z.object({
      base64: z.string().min(1).max(7000000),
      mime_type: z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
        "application/pdf",
      ]),
      influencer_id: uuid,
    }),
    async (db, a, r) => {
      demand(
        opts.storage && opts.scan,
        "STORAGE_DISABLED",
        "Configure Storage privado e antivírus",
        503,
      );
      return uploadPrivate(db, a, opts.storage, opts.scan, r.body as any);
    },
  );
  route("GET", "/storage/:id/download", undefined, async (db, a, r) => {
    demand(opts.storage, "STORAGE_DISABLED", "Storage não configurado", 503);
    const file = await resource(
      db,
      "storage_objects",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "governance.read", { influencerId: file.influencer_id });
    demand(
      file.scan_status === "clean",
      "FILE_NOT_CLEAN",
      "Arquivo ainda não liberado",
    );
    return { url: await opts.storage.sign(file.object_path), expires_in: 60 };
  });
  route("POST", "/accounts/:id/oauth", z.object({}), async (db, a, r) => {
    demand(
      opts.vault && process.env.X_CLIENT_ID && process.env.X_REDIRECT_URI,
      "OAUTH_DISABLED",
      "Configure aplicativo OAuth e cofre",
      503,
    );
    return beginX(db, a, uuid.parse((r.params as any).id), opts.vault, {
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      redirectUri: process.env.X_REDIRECT_URI,
    });
  });
  app.get("/api/v1/integrations/callback/x", async (req) => {
    const q = z
      .object({ state: z.string().min(32), code: z.string().min(1) })
      .parse(req.query);
    demand(
      opts.vault && process.env.X_CLIENT_ID && process.env.X_REDIRECT_URI,
      "OAUTH_DISABLED",
      "OAuth não configurado",
      503,
    );
    return finishX(opts.db, q.state, q.code, opts.vault, {
      clientId: process.env.X_CLIENT_ID,
      clientSecret: process.env.X_CLIENT_SECRET,
      redirectUri: process.env.X_REDIRECT_URI,
    });
  });
  route("GET", "/organizations", undefined, async (db, a) => ({
    data: (
      await db.query(
        "SELECT id,name,slug,default_locale,timezone FROM custom_dim.organizations WHERE id=$1",
        [a.organizationId],
      )
    ).rows,
  }));
  const resultPage = z.object({
    data: z.array(row),
    page: z.number(),
    per_page: z.number(),
    total: z.number(),
  });
  for (const [key, def] of Object.entries(readResources)) {
    app.get(
      `/api/v1/${key}`,
      {
        preHandler: auth,
        schema: {
          ...schema(key, undefined, resultPage),
          querystring: pageInput,
        },
      },
      async (r) =>
        scoped(opts.db, (r as Request).actor, (tx) =>
          list(tx, (r as Request).actor, key, r.query),
        ),
    );
    route("GET", `/${key}/:id`, undefined, async (db, a, r) => {
      const item = await resource(
        db,
        def.table,
        uuid.parse((r.params as any).id),
        a,
      );
      let canSee = visible(a, `${def.permission}.read`, item);
      if (!canSee && ["contacts", "consent_records"].includes(def.table)) {
        const links = (
          await db.query(
            "SELECT influencer_id FROM custom_dim.contact_influencers WHERE contact_id=$1",
            [def.table === "contacts" ? item.id : item.contact_id],
          )
        ).rows;
        canSee = links.some((link) =>
          visible(a, `${def.permission}.read`, {
            influencer_id: link.influencer_id,
          }),
        );
      }
      demand(canSee, "FORBIDDEN", "Escopo insuficiente", 403);
      return item;
    });
  }
  for (const [key, def] of Object.entries(resources))
    route("POST", `/${key}`, def.schema.strict(), async (db, a, r) =>
      createResource(db, a, key, r.body),
    );
  route(
    "PATCH",
    "/influencers/:id",
    identityInput
      .partial()
      .extend({ row_version: z.number().int().positive() })
      .strict(),
    async (db, a, r) =>
      patchIdentity(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route(
    "POST",
    "/influencers/:id/transition",
    transitionInput,
    async (db, a, r) =>
      transition(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route("GET", "/influencers/:id/blockers", undefined, async (db, a, r) => {
    const identity = await resource(
      db,
      "influencers",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "identity.read", { influencerId: identity.id });
    return {
      rights: await rightsBlockers(db, a, identity),
      activation: await activationBlockers(db, a, identity),
    };
  });
  route("POST", "/influencers/:id/personas", json, async (db, a, r) =>
    persona(db, a, uuid.parse((r.params as any).id), r.body),
  );
  for (const [path, table] of [
    ["personas", "influencer_personas"],
    ["contracts", "influencer_contracts"],
    ["history", "influencer_status_history"],
    ["assignments", "influencer_assignments"],
  ] as const)
    route("GET", `/influencers/:id/${path}`, undefined, async (db, a, r) => {
      const id = uuid.parse((r.params as any).id);
      await resource(db, "influencers", id, a);
      authorize(
        a,
        path === "personas" || path === "contracts"
          ? "governance.read"
          : "identity.read",
        { influencerId: id },
      );
      return {
        data: (
          await db.query(
            `SELECT * FROM custom_dim.${table} WHERE influencer_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
            [id, a.organizationId],
          )
        ).rows,
      };
    });
  route(
    "POST",
    "/influencers/:id/assignments",
    assignmentInput,
    async (db, a, r) => {
      const id = uuid.parse((r.params as any).id);
      await resource(db, "influencers", id, a);
      authorize(a, "identity.write", { influencerId: id });
      const data = assignmentInput.parse(r.body);
      await member(db, a, data.user_id);
      const row = await insert(db, "influencer_assignments", {
        ...data,
        organization_id: a.organizationId,
        influencer_id: id,
      });
      await audit(db, a, "assign", "influencer_assignments", row.id);
      return row;
    },
  );
  route(
    "POST",
    "/influencers/:id/profile",
    z.object({
      row_version: z.number().int().positive(),
      biography_short: text,
      biography_long: text.optional(),
      value_proposition: text,
      audience: json,
      positioning: json,
      appearance_settings: json,
    }),
    async (db, a, r) => {
      const id = uuid.parse((r.params as any).id);
      await resource(db, "influencers", id, a);
      authorize(a, "identity.write", { influencerId: id });
      const data = r.body as any;
      demand(
        await one(
          db,
          "UPDATE custom_dim.influencers SET row_version=row_version+1 WHERE id=$1 AND organization_id=$2 AND row_version=$3 RETURNING id",
          [id, a.organizationId, data.row_version],
        ),
        "VERSION_CONFLICT",
        "Perfil alterado; recarregue",
        409,
      );
      const row = await one(
        db,
        "INSERT INTO custom_dim.influencer_profiles(organization_id,influencer_id,biography_short,biography_long,value_proposition,audience,positioning,appearance_settings) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(influencer_id) DO UPDATE SET biography_short=excluded.biography_short,biography_long=excluded.biography_long,value_proposition=excluded.value_proposition,audience=excluded.audience,positioning=excluded.positioning,appearance_settings=excluded.appearance_settings RETURNING *",
        [
          a.organizationId,
          id,
          data.biography_short,
          data.biography_long,
          data.value_proposition,
          JSON.stringify(data.audience),
          JSON.stringify(data.positioning),
          JSON.stringify(data.appearance_settings),
        ],
      );
      await audit(db, a, "profile", "influencer_profiles", row.id);
      return row;
    },
  );
  route(
    "GET",
    "/influencers/:id/offboarding-report",
    undefined,
    async (db, a, r) => {
      const identity = await resource(
        db,
        "influencers",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "governance.read", { influencerId: identity.id });
      const accounts = (
        await db.query(
          "SELECT id,handle,account_status,integration_status FROM custom_dim.social_accounts WHERE influencer_id=$1",
          [identity.id],
        )
      ).rows;
      const jobs = (
        await db.query(
          "SELECT j.id,j.status,j.scheduled_at FROM custom_dim.publication_jobs j JOIN custom_dim.social_accounts c ON c.id=j.social_account_id WHERE c.influencer_id=$1",
          [identity.id],
        )
      ).rows;
      await audit(db, a, "offboarding_report", "influencers", identity.id);
      return {
        identity_id: identity.id,
        status: identity.status,
        accounts,
        jobs,
        retention: "Preserve evidence per approved organization policy",
        generated_at: new Date().toISOString(),
      };
    },
  );
  route("GET", "/contents/:id/compare", undefined, async (db, a, r) => {
    const c = await resource(
      db,
      "content_items",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "editorial.read", { influencerId: c.influencer_id });
    const versions = (
      await db.query(
        "SELECT version_number,body_text,payload_hash FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC LIMIT 2",
        [c.id],
      )
    ).rows;
    return {
      from: versions[1] || null,
      to: versions[0] || null,
      changed:
        versions.length > 1 &&
        versions[0].payload_hash !== versions[1].payload_hash,
    };
  });
  route(
    "GET",
    "/influencers/:id/personas/compare",
    undefined,
    async (db, a, r) => {
      const identity = await resource(
        db,
        "influencers",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "governance.read", { influencerId: identity.id });
      const versions = (
        await db.query(
          "SELECT version,public_bio,tone,traits,knowledge,boundaries FROM custom_dim.influencer_personas WHERE influencer_id=$1 ORDER BY version DESC LIMIT 2",
          [identity.id],
        )
      ).rows;
      return {
        from: versions[1] || null,
        to: versions[0] || null,
        changed:
          versions.length > 1 &&
          JSON.stringify(versions[0]) !== JSON.stringify(versions[1]),
      };
    },
  );
  for (const [path, table, permission] of [
    ["onboarding-tasks", "onboarding_tasks", "identity.write"],
    ["account-tasks", "account_provisioning_tasks", "accounts.write"],
  ] as const)
    route(
      "POST",
      `/${path}/:id/complete`,
      z.object({ evidence_object_id: uuid }),
      async (db, a, r) => {
        const task = await resource(
          db,
          table,
          uuid.parse((r.params as any).id),
          a,
        );
        const parent =
          table === "onboarding_tasks"
            ? await resource(db, "onboarding_sessions", task.session_id, a)
            : await resource(db, "social_accounts", task.social_account_id, a);
        authorize(a, permission, {
          influencerId: parent.influencer_id,
          accountId: task.social_account_id,
        });
        const evidence = await resource(
          db,
          "storage_objects",
          (r.body as any).evidence_object_id,
          a,
        );
        demand(
          evidence.scan_status === "clean",
          "FILE_NOT_CLEAN",
          "Evidência não liberada",
        );
        await db.query(
          `UPDATE custom_dim.${table} SET status='completed',evidence_object_id=$1 WHERE id=$2`,
          [evidence.id, task.id],
        );
        await audit(db, a, "complete", table, task.id);
        return { completed: true };
      },
    );
  route("POST", "/onboarding-sessions/:id/steps", json, async (db, a, r) =>
    saveOnboarding(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route(
    "GET",
    "/onboarding-sessions/:id/steps",
    undefined,
    async (db, a, r) => {
      const s = await resource(
        db,
        "onboarding_sessions",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "identity.read", { influencerId: s.influencer_id });
      return {
        data: (
          await db.query(
            "SELECT * FROM custom_dim.onboarding_steps WHERE session_id=$1",
            [s.id],
          )
        ).rows,
      };
    },
  );
  route(
    "POST",
    "/onboarding-sessions/:id/approve",
    z.object({ decision: z.enum(["approved", "rejected"]), comments: text }),
    async (db, a, r) => {
      const s = await resource(
        db,
        "onboarding_sessions",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "approval.write", { influencerId: s.influencer_id });
      const data = r.body as any;
      if (data.decision === "approved") {
        const identity = await resource(db, "influencers", s.influencer_id, a);
        const blockers = await rightsBlockers(db, a, identity);
        demand(!blockers.length, "RIGHTS_REQUIRED", blockers.join(", "));
      }
      const decision = await insert(db, "onboarding_approvals", {
        ...data,
        organization_id: a.organizationId,
        session_id: s.id,
        reviewer_id: a.userId,
        approval_type: "identity",
        decided_at: new Date().toISOString(),
      });
      await audit(db, a, "decision", "onboarding_approvals", decision.id);
      return decision;
    },
  );
  for (const [path, table] of [
    ["identity-consents", "identity_consents"],
    ["consents", "consent_records"],
  ] as const)
    route("POST", `/${path}/:id/revoke`, z.object({}), async (db, a, r) =>
      revokeConsent(db, a, table, uuid.parse((r.params as any).id)),
    );
  route(
    "POST",
    "/contents/:id/versions",
    versionInput.strict(),
    async (db, a, r) =>
      contentVersion(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route("GET", "/contents/:id/versions", undefined, async (db, a, r) => {
    const c = await resource(
      db,
      "content_items",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "editorial.read", { influencerId: c.influencer_id });
    return {
      data: (
        await db.query(
          "SELECT * FROM custom_dim.content_versions WHERE content_id=$1 ORDER BY version_number DESC",
          [c.id],
        )
      ).rows,
    };
  });
  route(
    "POST",
    "/contents/:id/approvals",
    approvalInput.strict(),
    async (db, a, r) =>
      approve(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route(
    "POST",
    "/content-versions/:id/verify",
    z.object({}),
    async (db, a, r) => verifyContent(db, a, uuid.parse((r.params as any).id)),
  );
  route("POST", "/publications", publicationInput.strict(), async (db, a, r) =>
    schedule(db, a, r.body, String(r.headers["idempotency-key"] || "")),
  );
  route("POST", "/publications/:id/cancel", z.object({}), async (db, a, r) =>
    cancelPublication(db, a, uuid.parse((r.params as any).id)),
  );
  route(
    "POST",
    "/publications/:id/retry",
    z.object({ reason: text }),
    async (db, a, r) => {
      const job = await resource(
        db,
        "publication_jobs",
        uuid.parse((r.params as any).id),
        a,
      );
      const account = await resource(
        db,
        "social_accounts",
        job.social_account_id,
        a,
      );
      authorize(a, "publication.write", {
        influencerId: account.influencer_id,
        accountId: account.id,
      });
      demand(
        ["failed", "blocked"].includes(job.status) &&
          [
            "RATE_LIMIT",
            "AUTH_REVOKED",
            "INTEGRATION_EXPIRED",
            "CAPABILITY_UNAVAILABLE",
            "NOT_SENT_VERIFIED",
          ].includes(job.last_error),
        "UNSAFE_RETRY",
        "Resultado exige reconciliação antes de reenviar",
        409,
      );
      await db.query(
        "UPDATE custom_dim.publication_jobs SET status='queued',scheduled_at=now() WHERE id=$1",
        [job.id],
      );
      await insert(db, "outbox_events", {
        organization_id: a.organizationId,
        event_id: randomUUID(),
        event_type: "social.publish",
        aggregate_id: job.id,
        correlation_id: a.correlationId,
        payload: { job_id: job.id },
      });
      await audit(db, a, "manual_retry", "publication_jobs", job.id, {
        reason: (r.body as any).reason,
      });
      return { queued: true };
    },
  );
  route(
    "POST",
    "/publications/:id/reconcile",
    z.object({
      outcome: z.enum(["published", "not_sent"]),
      external_post_id: text.optional(),
      evidence_object_id: uuid,
    }),
    async (db, a, r) => {
      authorize(a, "security.write");
      const job = await resource(
        db,
        "publication_jobs",
        uuid.parse((r.params as any).id),
        a,
      );
      demand(
        job.status === "uncertain",
        "RECONCILIATION_NOT_REQUIRED",
        "Job sem resultado incerto",
        409,
      );
      const data = r.body as any;
      const evidence = await resource(
        db,
        "storage_objects",
        data.evidence_object_id,
        a,
      );
      demand(
        evidence.scan_status === "clean",
        "FILE_NOT_CLEAN",
        "Evidência não liberada",
      );
      if (data.outcome === "published") {
        demand(
          data.external_post_id,
          "EXTERNAL_ID_REQUIRED",
          "Informe ID do provedor",
        );
        await insert(db, "published_posts", {
          organization_id: a.organizationId,
          job_id: job.id,
          external_post_id: data.external_post_id,
          published_at: new Date().toISOString(),
          state: "published",
        });
      }
      await db.query(
        "UPDATE custom_dim.publication_jobs SET status=$1,last_error=$2 WHERE id=$3",
        [
          data.outcome === "published" ? "published" : "blocked",
          data.outcome === "published" ? null : "NOT_SENT_VERIFIED",
          job.id,
        ],
      );
      await audit(db, a, "reconciled", "publication_jobs", job.id, data);
      return { reconciled: true, outcome: data.outcome };
    },
  );
  route("GET", "/calendar", undefined, async (db, a) => {
    authorize(a, "publication.read");
    return {
      data: (
        await db.query(
          "SELECT * FROM custom_dim.editorial_calendar_items WHERE organization_id=$1 ORDER BY planned_at",
          [a.organizationId],
        )
      ).rows,
    };
  });
  route("POST", "/conversations/:id/messages", json, async (db, a, r) =>
    sendMessage(
      db,
      a,
      uuid.parse((r.params as any).id),
      r.body,
      String(r.headers["idempotency-key"] || ""),
    ),
  );
  route("GET", "/conversations/:id/messages", undefined, async (db, a, r) => {
    const c = await resource(
      db,
      "conversations",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "inbox.read", {
      influencerId: c.influencer_id,
      accountId: c.social_account_id,
    });
    return {
      data: (
        await db.query(
          "SELECT * FROM custom_dim.messages WHERE conversation_id=$1 ORDER BY occurred_at LIMIT 100",
          [c.id],
        )
      ).rows,
    };
  });
  route("GET", "/conversations/:id/context", undefined, async (db, a, r) => {
    const c = await resource(
      db,
      "conversations",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "inbox.read", {
      influencerId: c.influencer_id,
      accountId: c.social_account_id,
    });
    const contact = await resource(db, "contacts", c.contact_id, a);
    return {
      contact,
      notes: (
        await db.query(
          "SELECT note_body,author_id,created_at FROM custom_dim.conversation_notes WHERE conversation_id=$1 ORDER BY created_at",
          [c.id],
        )
      ).rows,
      team: (
        await db.query(
          "SELECT m.user_id,p.display_name FROM custom_dim.organization_members m LEFT JOIN custom_dim.user_profiles p ON p.user_id=m.user_id WHERE m.organization_id=$1 AND m.status='active'",
          [a.organizationId],
        )
      ).rows,
      templates: (
        await db.query(
          "SELECT id,provider_template_id,language,category FROM custom_dim.message_templates WHERE organization_id=$1 AND approval_status='approved' AND content->>'social_account_id'=$2",
          [a.organizationId, c.social_account_id],
        )
      ).rows,
      sla_hours: 24,
      opened_at: c.opened_at,
    };
  });
  route("POST", "/conversations/:id/handoff", json, async (db, a, r) =>
    handoff(db, a, uuid.parse((r.params as any).id), r.body),
  );
  route("GET", "/analytics/overview", undefined, async (db, a) =>
    analytics(db, a),
  );
  route(
    "POST",
    "/metrics/samples",
    z.object({
      published_post_id: uuid,
      metric_code: text,
      metric_value: z.number().nonnegative(),
      observed_at: z.iso.datetime({ offset: true }),
      provenance: text,
    }),
    async (db, a, r) => {
      authorize(a, "commercial.write");
      const data = r.body as any;
      await resource(db, "published_posts", data.published_post_id, a);
      const sample = await insert(db, "publication_metrics", {
        ...data,
        organization_id: a.organizationId,
      });
      await audit(db, a, "metric_sample", "publication_metrics", sample.id, {
        provenance: data.provenance,
      });
      return sample;
    },
  );
  route(
    "POST",
    "/deliverables/:id/transition",
    z.object({
      status: z.enum([
        "planned",
        "in_progress",
        "delivered",
        "accepted",
        "cancelled",
      ]),
    }),
    async (db, a, r) => {
      const row = await resource(
        db,
        "campaign_deliverables",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "commercial.write", { influencerId: row.influencer_id });
      await db.query(
        "UPDATE custom_dim.campaign_deliverables SET status=$1 WHERE id=$2",
        [(r.body as any).status, row.id],
      );
      await audit(db, a, "transition", "campaign_deliverables", row.id, r.body);
      return { status: (r.body as any).status };
    },
  );
  route("GET", "/reports/financial", undefined, async (db, a) => {
    authorize(a, "commercial.read");
    const report = await analytics(db, a);
    await audit(db, a, "export", "organizations", a.organizationId, {
      report: "financial",
    });
    return report;
  });
  route("GET", "/dashboard", undefined, async (db, a) => {
    const counts: Record<string, any> = {};
    for (const key of [
      "influencers",
      "accounts",
      "contents",
      "publications",
      "conversations",
      "campaigns",
    ]) {
      try {
        const result = await list(db, a, key, { per_page: 1 });
        counts[key] = { total: result.total, source: readResources[key].table };
      } catch (e) {
        if (e instanceof AppError && e.status === 403)
          counts[key] = { state: "permission_denied" };
        else throw e;
      }
    }
    return { counts, as_of: new Date().toISOString(), source: "custom_dim" };
  });
  route(
    "POST",
    "/agent-runs",
    z.object({
      agent_assignment_id: uuid,
      task_type: z.enum([
        "content.research",
        "content.generate",
        "content.verify",
        "inbox.triage",
      ]),
      content_id: uuid,
      input: text,
    }),
    async (db, a, r) => {
      const data = r.body as any;
      const assignment = await resource(
        db,
        "agent_assignments",
        data.agent_assignment_id,
        a,
      );
      authorize(a, "agents.write", { influencerId: assignment.influencer_id });
      demand(assignment.enabled, "AGENT_DISABLED", "Agente desativado");
      const content = await resource(db, "content_items", data.content_id, a);
      demand(
        content.influencer_id === assignment.influencer_id,
        "IDENTITY_MISMATCH",
        "Conteúdo de outra identidade",
      );
      const config = await resource(
        db,
        "ai_model_configs",
        assignment.model_config_id,
        a,
      );
      demand(
        config.cost_policy.max_tokens && config.cost_policy.budget,
        "BUDGET_REQUIRED",
        "Defina limites de tokens e custo",
      );
      const used = await one(
        db,
        "SELECT coalesce(sum(cost),0)::numeric AS cost FROM custom_dim.agent_runs WHERE agent_assignment_id=$1",
        [assignment.id],
      );
      demand(
        Number(used.cost) < Number(config.cost_policy.budget),
        "BUDGET_EXCEEDED",
        "Limite do agente atingido",
      );
      return operation(
        db,
        a,
        data.task_type,
        assignment.id,
        {
          ...data,
          requested_by: a.userId,
          max_tokens: config.cost_policy.max_tokens,
          currency: config.cost_policy.currency,
        },
        String(r.headers["idempotency-key"] || ""),
      );
    },
  );
  route(
    "POST",
    "/agent-assignments/:id/enable",
    z.object({ enabled: z.boolean() }),
    async (db, a, r) => {
      const assignment = await resource(
        db,
        "agent_assignments",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "agents.write", { influencerId: assignment.influencer_id });
      const enabled = (r.body as any).enabled;
      if (enabled) {
        const config = await resource(
          db,
          "ai_model_configs",
          assignment.model_config_id,
          a,
        );
        demand(
          config.cost_policy.max_tokens &&
            config.cost_policy.budget &&
            config.cost_policy.input_per_million !== undefined &&
            config.cost_policy.output_per_million !== undefined,
          "COST_POLICY_REQUIRED",
          "Configure preços e orçamento",
        );
      }
      await db.query(
        "UPDATE custom_dim.agent_assignments SET enabled=$1 WHERE id=$2",
        [enabled, assignment.id],
      );
      await audit(db, a, "enable", "agent_assignments", assignment.id, {
        enabled,
      });
      return { enabled };
    },
  );
  for (const action of ["membership", "role", "policy"] as const)
    app.post(
      `/api/v1/security/${action}`,
      { preHandler: auth, schema: schema("security", json) },
      async (r) => accessCommand(opts.db, (r as Request).actor, action, r.body),
    );
  route("GET", "/platforms", undefined, async (db, a) => {
    authorize(a, "accounts.read");
    return {
      data: (
        await db.query(
          "SELECT id,code,name,capabilities FROM custom_dim.platforms WHERE enabled=true",
        )
      ).rows,
    };
  });
  route("GET", "/agent-definitions", undefined, async (db, a) => {
    authorize(a, "agents.read");
    return {
      data: (
        await db.query(
          "SELECT id,code,name,purpose,capabilities FROM custom_dim.agent_definitions WHERE status=$1",
          ["active"],
        )
      ).rows,
    };
  });
  route("GET", "/connectors", undefined, async (db, a) => {
    authorize(a, "accounts.read");
    return {
      data: (
        await db.query(
          "SELECT c.*,p.name AS platform FROM custom_dim.connectors c JOIN custom_dim.platforms p ON p.id=c.platform_id",
        )
      ).rows,
    };
  });
  route(
    "POST",
    "/accounts/:id/connect",
    z.object({ secret_ref: text }),
    async (db, a, r) => {
      authorize(a, "security.write");
      const account = await resource(
        db,
        "social_accounts",
        uuid.parse((r.params as any).id),
        a,
      );
      const provider = await one(
        db,
        "SELECT * FROM custom_dim.platforms WHERE id=$1",
        [account.platform_id],
      );
      demand(
        ["telegram", "whatsapp"].includes(provider?.code),
        "OFFICIAL_SETUP_REQUIRED",
        "Use autorização oficial; este conector ainda não possui OAuth habilitado",
        422,
      );
      demand(opts.vault, "VAULT_UNAVAILABLE", "Configure o cofre", 503);
      const ref = (r.body as any).secret_ref;
      demand(
        ref.startsWith(`dim/${a.organizationId}/${account.id}/`),
        "INVALID_VAULT_SCOPE",
        "Referência não pertence à conta",
        403,
      );
      const secret = await opts.vault.get(ref);
      const capabilities: {
        publish: boolean;
        readMessages: boolean;
        sendMessages: boolean;
        scopes?: string[];
        expiresAt?: string;
      } =
        provider.code === "whatsapp"
          ? await whatsappHealth(
              secret.token,
              account.external_id,
              secret.app_access_token,
            )
          : await new TelegramConnector().health(
              secret.token,
              account.external_id,
            );
      const connector = await one(
        db,
        "SELECT id FROM custom_dim.connectors WHERE platform_id=$1 AND enabled=true ORDER BY version DESC LIMIT 1",
        [account.platform_id],
      );
      demand(connector, "CONNECTOR_DISABLED", "Conector desativado");
      await db.query(
        "UPDATE custom_dim.account_integrations SET status='revoked' WHERE social_account_id=$1 AND status='active'",
        [account.id],
      );
      const integration = await insert(db, "account_integrations", {
        organization_id: a.organizationId,
        social_account_id: account.id,
        connector_id: connector.id,
        auth_type:
          provider.code === "whatsapp" ? "system_user_token" : "bot_token",
        secret_ref: ref,
        granted_scopes:
          capabilities.scopes ||
          Object.entries(capabilities)
            .filter(([, v]) => v)
            .map(([k]) => k),
        status: "active",
        last_tested_at: new Date().toISOString(),
        expires_at: capabilities.expiresAt,
      });
      for (const [capability, available] of Object.entries({
        publish_text: capabilities.publish,
        read_messages: capabilities.readMessages,
        send_messages: capabilities.sendMessages,
      }))
        await db.query(
          "INSERT INTO custom_dim.account_capabilities(organization_id,social_account_id,capability_code,available,checked_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(social_account_id,capability_code) DO UPDATE SET available=excluded.available,checked_at=now()",
          [a.organizationId, account.id, capability, available],
        );
      await db.query(
        "UPDATE custom_dim.social_accounts SET integration_status='connected',account_status='active' WHERE id=$1",
        [account.id],
      );
      await audit(db, a, "connect", "social_accounts", account.id, {
        integration_id: integration.id,
      });
      return { connected: true, capabilities };
    },
  );
  route(
    "POST",
    "/accounts/:id/sync-templates",
    z.object({}),
    async (db, a, r) => {
      const account = await resource(
        db,
        "social_accounts",
        uuid.parse((r.params as any).id),
        a,
      );
      authorize(a, "inbox.write", {
        influencerId: account.influencer_id,
        accountId: account.id,
      });
      demand(opts.vault, "VAULT_UNAVAILABLE", "Configure o cofre", 503);
      const integration = await one(
        db,
        "SELECT i.*,p.code AS provider FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE i.social_account_id=$1 AND i.status='active' AND (i.expires_at IS NULL OR i.expires_at>now())",
        [account.id],
      );
      demand(
        integration?.provider === "whatsapp",
        "WHATSAPP_REQUIRED",
        "Conta WhatsApp autorizada necessária",
      );
      const secret = await opts.vault.get(integration.secret_ref);
      demand(
        /^\d+$/.test(secret.waba_id || ""),
        "WABA_REQUIRED",
        "Configure WABA no cofre",
      );
      const version = process.env.WHATSAPP_GRAPH_VERSION;
      demand(
        version && /^v\d+\.\d+$/.test(version),
        "GRAPH_VERSION_REQUIRED",
        "Configure versão Graph",
      );
      const response = await fetch(
        `https://graph.facebook.com/${version}/${secret.waba_id}/message_templates?fields=id,name,status,language,category,components&limit=100`,
        {
          headers: { Authorization: `Bearer ${secret.token}` },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      demand(
        response.ok,
        "TEMPLATES_UNAVAILABLE",
        "Falha ao consultar templates",
        502,
      );
      const result = await response.json();
      await db.query(
        "UPDATE custom_dim.message_templates SET approval_status='stale' WHERE organization_id=$1 AND provider='whatsapp' AND content->>'social_account_id'=$2",
        [a.organizationId, account.id],
      );
      for (const template of result.data || [])
        await insert(db, "message_templates", {
          organization_id: a.organizationId,
          provider: "whatsapp",
          provider_template_id: template.name,
          language: template.language,
          category: template.category,
          content: {
            components: template.components,
            provider_id: template.id,
            social_account_id: account.id,
            synced_at: new Date().toISOString(),
          },
          approval_status:
            template.status === "APPROVED"
              ? "approved"
              : String(template.status).toLowerCase(),
        });
      await audit(db, a, "sync_templates", "social_accounts", account.id, {
        count: result.data?.length || 0,
        partial: !!result.paging?.next,
      });
      return {
        count: result.data?.length || 0,
        partial: !!result.paging?.next,
      };
    },
  );
  route("GET", "/accounts/:id/capabilities", undefined, async (db, a, r) => {
    const account = await resource(
      db,
      "social_accounts",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "accounts.read", {
      influencerId: account.influencer_id,
      accountId: account.id,
    });
    return {
      data: (
        await db.query(
          "SELECT capability_code,available,checked_at,restriction_reason FROM custom_dim.account_capabilities WHERE social_account_id=$1",
          [account.id],
        )
      ).rows,
    };
  });
  route("GET", "/accounts/:id/health", undefined, async (db, a, r) => {
    const account = await resource(
      db,
      "social_accounts",
      uuid.parse((r.params as any).id),
      a,
    );
    authorize(a, "accounts.read", {
      influencerId: account.influencer_id,
      accountId: account.id,
    });
    const integration = await one(
      db,
      "SELECT status,expires_at,last_tested_at FROM custom_dim.account_integrations WHERE social_account_id=$1 ORDER BY created_at DESC LIMIT 1",
      [account.id],
    );
    return {
      account_status: account.account_status,
      integration_status: account.integration_status,
      integration,
      stale:
        !integration ||
        Date.now() - new Date(integration.last_tested_at).getTime() > 86400000,
    };
  });
  app.post("/api/v1/webhooks/:provider/:accountId", async (req) => {
    const { provider, accountId } = req.params as any;
    uuid.parse(accountId);
    const account = await one(
      opts.db,
      "SELECT a.*,p.code AS provider FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE a.id=$1",
      [accountId],
    );
    demand(
      account && account.provider === provider,
      "NOT_FOUND",
      "Conta desconhecida",
      404,
    );
    let telegramSecret: string | undefined;
    if (provider === "telegram") {
      demand(opts.vault, "WEBHOOK_DISABLED", "Cofre necessário", 503);
      telegramSecret = (
        await opts.vault.get(
          `dim/${account.organization_id}/${account.id}/webhook`,
        )
      ).secret;
    }
    verifyWebhook(provider, (req as Request).rawBody, req.headers, {
      telegram: telegramSecret,
      whatsapp: process.env.WHATSAPP_APP_SECRET,
    });
    return opts.db.transaction((tx) =>
      ingest(tx, account.organization_id, account, provider, req.body),
    );
  });
  app.post("/api/v1/webhooks/whatsapp", async (req) => {
    verifyWebhook("whatsapp", (req as Request).rawBody, req.headers, {
      whatsapp: process.env.WHATSAPP_APP_SECRET,
    });
    const payload = req.body as any;
    for (const entry of payload.entry || [])
      for (const change of entry.changes || []) {
        const phone = String(change.value?.metadata?.phone_number_id || "");
        const account = await one(
          opts.db,
          "SELECT a.* FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE p.code='whatsapp' AND a.external_id=$1",
          [phone],
        );
        if (account)
          await opts.db.transaction((tx) =>
            ingest(tx, account.organization_id, account, "whatsapp", {
              entry: [{ ...entry, changes: [change] }],
            }),
          );
      }
    return { accepted: true };
  });
  app.get("/api/v1/webhooks/whatsapp", async (req) => {
    const q = req.query as any;
    demand(
      q["hub.mode"] === "subscribe" &&
        !!process.env.WHATSAPP_VERIFY_TOKEN &&
        q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN,
      "INVALID_VERIFY_TOKEN",
      "Token inválido",
      403,
    );
    return String(q["hub.challenge"]);
  });
  app.get("/openapi.json", async () => app.swagger());
  app.setNotFoundHandler((r, reply) =>
    reply.code(404).send({
      code: "NOT_FOUND",
      message: "Rota não encontrada",
      correlation_id: r.id,
    }),
  );
  completionRoutes(app, route, opts, auth);
  await app.ready();
  return app;
}
