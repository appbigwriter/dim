import {
  bindAudience,
  audienceState,
  syncAudience,
} from "../../../packages/core/src/audience";
import { audienceBindingInput } from "../../../packages/contracts/src/audience";
import type { AudienceProvider } from "../../../packages/connectors/src/audience";
import { identityChannels } from "../../../packages/core/src/channels";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  demand,
  uuid,
  text,
  type Actor,
} from "../../../packages/contracts/src/index";
import {
  one,
  insert,
  type DB,
  type Database,
} from "../../../packages/db/src/index";
import {
  audit,
  authorize,
  resource,
  visible,
} from "../../../packages/core/src/security";
import {
  onboardingChecklist,
  completeOnboardingStep,
  finishOnboarding,
  reschedule,
  conversationPreferences,
  mergeContacts,
  exportContact,
  saveInboxPolicy,
  reconcileCost,
} from "../../../packages/core/src/completion";
import {
  inviteMember,
  acceptInvitation,
  type Inviter,
} from "../../../packages/core/src/invitations";
export type CommandRoute = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  body: any,
  handler: (db: DB, actor: Actor, request: any) => Promise<any>,
) => void;
export function completionRoutes(
  app: FastifyInstance,
  route: CommandRoute,
  opts: {
    db: Database;
    invite?: Inviter;
    audience?: AudienceProvider;
    session?: (
      token: string,
    ) => Promise<{ userId: string; emailVerified?: boolean }>;
  },
  auth: (request: FastifyRequest) => Promise<void>,
) {
  route(
    "POST",
    "/influencers/:id/audience/bind",
    audienceBindingInput,
    (db, a, r) => bindAudience(db, a, uuid.parse(r.params.id), r.body),
  );
  route("GET", "/influencers/:id/audience", undefined, (db, a, r) =>
    audienceState(db, a, uuid.parse(r.params.id)),
  );
  route("GET", "/influencers/:id/audience/context", undefined, (db, a, r) =>
    audienceState(db, a, uuid.parse(r.params.id), true),
  );
  app.post(
    "/api/v1/influencers/:id/audience/sync",
    { preHandler: auth, schema: { body: z.object({}).strict() } },
    async (req) => {
      demand(
        opts.audience,
        "AUDIENCE_NOT_CONFIGURED",
        "Configure a conexão Audience no cofre e a API oficial de contexto",
        503,
      );
      return syncAudience(
        opts.db,
        (req as any).actor,
        uuid.parse((req.params as any).id),
        opts.audience,
      );
    },
  );
  route("GET", "/influencers/:id/channels", undefined, (db, a, r) =>
    identityChannels(db, a, uuid.parse(r.params.id)),
  );
  route("GET", "/onboarding-sessions/:id/checklist", undefined, (db, a, r) =>
    onboardingChecklist(db, a, uuid.parse(r.params.id)),
  );
  route(
    "POST",
    "/onboarding-sessions/:id/complete-step",
    z.object({ step: z.string() }),
    (db, a, r) =>
      completeOnboardingStep(db, a, uuid.parse(r.params.id), r.body.step),
  );
  route(
    "POST",
    "/onboarding-sessions/:id/activate",
    z.object({ confirmed: z.literal(true), reason: text }),
    (db, a, r) => finishOnboarding(db, a, uuid.parse(r.params.id), r.body),
  );
  route(
    "POST",
    "/publications/:id/reschedule",
    z.object({
      scheduled_at: z.iso.datetime({ offset: true }),
      row_version: z.number().int().positive(),
    }),
    (db, a, r) => reschedule(db, a, uuid.parse(r.params.id), r.body),
  );
  route(
    "POST",
    "/conversations/:id/preferences",
    z.object({
      tags: z.array(text).optional(),
      mark_read: z.literal(true).optional(),
    }),
    (db, a, r) =>
      conversationPreferences(db, a, uuid.parse(r.params.id), r.body),
  );
  route(
    "POST",
    "/contacts/:id/merge",
    z.object({ target_id: uuid, reason: text }),
    (db, a, r) =>
      mergeContacts(
        db,
        a,
        uuid.parse(r.params.id),
        r.body.target_id,
        r.body.reason,
      ),
  );
  route("GET", "/contacts/:id/export", undefined, (db, a, r) =>
    exportContact(db, a, uuid.parse(r.params.id)),
  );
  route(
    "POST",
    "/contacts/:id/privacy-request",
    z.object({
      request_type: z.enum(["access", "correction", "erasure", "restriction"]),
      reason: text,
    }),
    async (db, a, r) => {
      authorize(a, "inbox.write");
      const contact = await resource(
        db,
        "contacts",
        uuid.parse(r.params.id),
        a,
      );
      const request = await insert(db, "operation_jobs", {
        organization_id: a.organizationId,
        job_type: "privacy.request",
        subject_id: contact.id,
        status: "pending_human",
        payload: { ...r.body, requested_by: a.userId },
      });
      await audit(db, a, "privacy_request", "contacts", contact.id, {
        request_id: request.id,
        type: r.body.request_type,
      });
      return request;
    },
  );
  route("GET", "/contacts/:id/linked", undefined, async (db, a, r) => {
    authorize(a, "inbox.read");
    const contact = await resource(db, "contacts", uuid.parse(r.params.id), a);
    return {
      data: (
        await db.query(
          "SELECT id,display_name,status,merged_into_id FROM custom_dim.contacts WHERE merged_into_id=$1 OR id=$2",
          [
            contact.merged_into_id || contact.id,
            contact.merged_into_id || contact.id,
          ],
        )
      ).rows,
    };
  });
  app.post("/api/v1/settings/inbox", { preHandler: auth }, async (req) =>
    opts.db.transaction((tx) =>
      saveInboxPolicy(tx, (req as any).actor, req.body),
    ),
  );
  route("GET", "/settings/inbox", undefined, async (db, a) => {
    authorize(a, "inbox.read");
    return (
      (
        await one(
          db,
          "SELECT settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='inbox'",
          [a.organizationId],
        )
      )?.settings || {
        sla_hours: 24,
        retention_days: 365,
        whatsapp_window_hours: 24,
      }
    );
  });
  route(
    "POST",
    "/incidents/:id/resolve",
    z.object({ reason: text }),
    async (db, a, r) => {
      authorize(a, "security.write");
      const incident = await resource(
        db,
        "security_incidents",
        uuid.parse(r.params.id),
        a,
      );
      await db.query(
        "UPDATE custom_dim.security_incidents SET state='resolved',resolved_at=now() WHERE id=$1",
        [incident.id],
      );
      await audit(db, a, "resolve", "security_incidents", incident.id, r.body);
      return { resolved: true };
    },
  );
  app.post(
    "/api/v1/security/invitations",
    { preHandler: auth },
    async (req) => {
      demand(
        opts.invite,
        "INVITATIONS_DISABLED",
        "Configure Auth administrativo e SMTP",
        503,
      );
      return inviteMember(
        opts.db,
        (req as any).actor,
        opts.invite,
        req.body,
        String(req.headers["idempotency-key"] || ""),
      );
    },
  );
  app.post("/api/v1/invitations/:id/accept", async (req) => {
    demand(opts.session, "AUTH_DISABLED", "Auth não configurado", 503);
    const token = String(req.headers.authorization || "").replace(
      /^Bearer /,
      "",
    );
    demand(token, "UNAUTHENTICATED", "Entre pelo link do convite", 401);
    const session = await opts.session(token);
    return acceptInvitation(
      opts.db,
      uuid.parse((req.params as any).id),
      session,
    );
  });
  app.get("/api/v1/security/sessions", { preHandler: auth }, async (req) => {
    const a = (req as any).actor as Actor;
    authorize(a, "security.read");
    return {
      data: (
        await opts.db.query(
          "SELECT s.id,s.user_id,s.created_at,s.not_after,EXISTS(SELECT 1 FROM custom_dim.organization_settings o WHERE o.organization_id=$1 AND o.module_key='revoked_session:'||s.id::text) AS revoked FROM auth.sessions s JOIN custom_dim.organization_members m ON m.user_id=s.user_id WHERE m.organization_id=$1 AND m.status='active'",
          [a.organizationId],
        )
      ).rows,
    };
  });
  app.post(
    "/api/v1/security/sessions/:id/revoke",
    { preHandler: auth },
    async (req) => {
      const a = (req as any).actor as Actor;
      authorize(a, "security.write");
      const id = uuid.parse((req.params as any).id);
      demand(
        await one(
          opts.db,
          "SELECT s.id FROM auth.sessions s JOIN custom_dim.organization_members m ON m.user_id=s.user_id WHERE s.id=$1 AND m.organization_id=$2",
          [id, a.organizationId],
        ),
        "NOT_FOUND",
        "Sessão não encontrada",
        404,
      );
      await opts.db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO custom_dim.organization_settings(organization_id,module_key,settings) VALUES($1,$2,'{}') ON CONFLICT DO NOTHING",
          [a.organizationId, `revoked_session:${id}`],
        );
        await audit(
          tx,
          a,
          "session_revoked",
          "organizations",
          a.organizationId,
          { session_id: id },
        );
      });
      return { revoked: true };
    },
  );
  route(
    "POST",
    "/agent-runs/:id/reconcile-cost",
    z.record(z.string(), z.any()),
    (db, a, r) => reconcileCost(db, a, uuid.parse(r.params.id), r.body),
  );
  route("GET", "/calendar-range", undefined, async (db, a, r) => {
    const range = z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .parse(r.query);
    demand(
      Date.parse(range.to) > Date.parse(range.from) &&
        Date.parse(range.to) - Date.parse(range.from) <= 366 * 86400000,
      "INVALID_RANGE",
      "Informe período de até 366 dias",
    );
    demand(
      a.grants.some(
        (g) => g.permission === "*" || g.permission === "publication.read",
      ),
      "FORBIDDEN",
      "Permissão insuficiente",
      403,
    );
    return {
      data: (
        await db.query(
          "SELECT c.*,j.status AS job_status,j.row_version,i.public_name,a.handle,t.title FROM custom_dim.editorial_calendar_items c JOIN custom_dim.publication_jobs j ON j.id=c.publication_job_id JOIN custom_dim.social_accounts a ON a.id=c.social_account_id JOIN custom_dim.influencers i ON i.id=c.influencer_id JOIN custom_dim.content_items t ON t.id=c.content_id WHERE c.organization_id=$1 AND c.planned_at>=$2 AND c.planned_at<$3 ORDER BY c.planned_at",
          [a.organizationId, range.from, range.to],
        )
      ).rows.filter((row) => visible(a, "publication.read", row)),
    };
  });
}
