import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Actor } from "../../../packages/contracts/src/index";
import type { Database } from "../../../packages/db/src/index";
import { scoped } from "../../../packages/core/src/security";
import { inboxRevision } from "../../../packages/core/src/realtime";
export function registerInboxRealtime(
  app: FastifyInstance,
  opts: { db: Database },
  auth: (request: FastifyRequest) => Promise<void>,
) {
  app.get("/api/v1/inbox/events", { preHandler: auth }, async (req, reply) => {
    let cursor = String(req.headers["last-event-id"] || "");
    if (!/^[a-f0-9]{64}$/.test(cursor)) cursor = "";
    const initial = await scoped(opts.db, (req as any).actor, (tx) =>
      inboxRevision(tx, (req as any).actor),
    );
    reply.hijack();
    for (const [name, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined)
        reply.raw.setHeader(
          name,
          Array.isArray(value) ? value.map(String) : String(value),
        );
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    let stopped = false,
      ticking = false;
    const send = (revision: string) => {
      if (revision !== cursor) {
        cursor = revision;
        reply.raw.write(
          `id: ${revision}\nevent: inbox.changed\ndata: ${JSON.stringify({ revision })}\n\n`,
        );
      } else reply.raw.write(": heartbeat\n\n");
    };
    send(initial);
    const timer = setInterval(async () => {
      if (stopped || ticking) return;
      ticking = true;
      try {
        await auth(req);
        const actor = (req as any).actor as Actor;
        const revision = await scoped(opts.db, actor, (tx) =>
          inboxRevision(tx, actor),
        );
        if (!stopped) send(revision);
      } catch {
        if (!stopped) {
          reply.raw.write("event: access.revoked\ndata: {}\n\n");
          reply.raw.end();
        }
        cleanup();
      } finally {
        ticking = false;
      }
    }, 3000);
    const lifespan = setTimeout(
      () => {
        reply.raw.end();
        cleanup();
      },
      10 * 60 * 1000,
    );
    function cleanup() {
      stopped = true;
      clearInterval(timer);
      clearTimeout(lifespan);
    }
    reply.raw.on("close", cleanup);
  });
}
