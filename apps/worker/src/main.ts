import {
  monitorAccounts,
  collectMetrics,
} from "../../../packages/core/src/monitoring";
import { templateParameters } from "../../../packages/connectors/src/templates";
import { oauthConfigFromEnvironment } from "../../../packages/connectors/src/oauth-multichannel";
import { refreshOAuthIntegrations } from "../../../packages/core/src/oauth";
import { runScheduledInboxEscalations } from "../../../packages/core/src/realtime";
import { collectAdditionalMetrics } from "../../../packages/core/src/additional-metrics";
import { processEmailWebhook } from "../../../packages/core/src/email-webhooks";
import { audienceActions } from "../../../packages/connectors/src/audience-actions";
import {
  observeAudienceExecutions,
  enrichAudienceReceipts,
  flushAudienceReceipts,
  pollAudienceActions,
} from "../../../packages/core/src/audience-execution";
import { audienceProvider } from "../../../packages/connectors/src/audience";
import { sendEmailReply } from "../../../packages/core/src/email";
import { executeAudienceOperation } from "../../../packages/core/src/audience-operations";
import { channelConnector } from "../../../packages/connectors/src/channels";
import { supabaseStorage } from "../../../packages/connectors/src/storage";
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { postgres, one, insert } from "../../../packages/db/src/index";
import {
  HashicorpVault,
  TelegramConnector,
  XConnector,
  whatsappSend,
  ProviderFailure,
} from "../../../packages/connectors/src/index";
import {
  normalizeIncoming,
  messageGuard,
} from "../../../packages/core/src/inbox";
import { loadActor } from "../../../packages/core/src/access";
import { scoped } from "../../../packages/core/src/security";
import { demand } from "../../../packages/contracts/src/index";
import { executePublication } from "./publication";
for (const name of ["DATABASE_URL", "REDIS_URL", "VAULT_ADDR", "VAULT_TOKEN"])
  if (!process.env[name]) throw new Error(`Configure ${name}`);
const db = postgres(process.env.DATABASE_URL!);
const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});
const vault = new HashicorpVault(
  process.env.VAULT_ADDR!,
  process.env.VAULT_TOKEN!,
  process.env.VAULT_MOUNT,
);
const telegram = new TelegramConnector();
const storage =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? supabaseStorage(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      )
    : undefined;
const queue = new Queue("dim", { connection });
const dlq = new Queue("dim-dlq", { connection });
async function reserveRate(provider: string, accountId: string) {
  const script = `local p=tonumber(redis.call('GET',KEYS[1]) or '0');local a=tonumber(redis.call('GET',KEYS[2]) or '0');if p>=tonumber(ARGV[1]) or a>=tonumber(ARGV[2]) then return 0 end;local pn=redis.call('INCR',KEYS[1]);local an=redis.call('INCR',KEYS[2]);if pn==1 then redis.call('PEXPIRE',KEYS[1],1000) end;if an==1 then redis.call('PEXPIRE',KEYS[2],60000) end;return 1`;
  try {
    const allowed = await connection.eval(
      script,
      2,
      `dim:rate:provider:${provider}`,
      `dim:rate:account:${accountId}`,
      Number(process.env.PROVIDER_RATE_PER_SECOND || 5),
      Number(process.env.ACCOUNT_RATE_PER_MINUTE || 10),
    );
    if (allowed !== 1) throw new ProviderFailure("retry", "RATE_LIMIT", 60);
  } catch (e) {
    if (e instanceof ProviderFailure) throw e;
    throw new ProviderFailure("retry", "RATE_DEPENDENCY_UNAVAILABLE", 30);
  }
}
const worker = new Worker(
  "dim",
  async (job) => {
    if (job.name === "social.publish") {
      const provider = await one(
        db,
        "SELECT p.code,a.id AS account_id FROM custom_dim.publication_jobs j JOIN custom_dim.social_accounts a ON a.id=j.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE j.id=$1",
        [job.data.id],
      );
      demand(
        ["telegram", "x", "facebook", "instagram", "youtube", "cms"].includes(
          provider?.code,
        ),
        "PROVIDER_DISABLED",
        "Conector social não habilitado",
      );
      return executePublication(
        db,
        job.data.id,
        (secret, resolve) => {
          const connector =
            provider.code === "x"
              ? new XConnector()
              : provider.code === "telegram"
                ? telegram
                : channelConnector(provider.code, secret, resolve);
          return {
            health: connector.health.bind(connector),
            publish: async (input) => {
              await reserveRate(provider.code, provider.account_id);
              return connector.publish(input);
            },
          };
        },
        vault,
        storage,
        audienceActions(vault, fetch, process.env.APP_ENV === "development"),
      );
    }
    const operation = await one(
      db,
      "SELECT * FROM custom_dim.operation_jobs WHERE id=$1",
      [job.data.id],
    );
    if (!operation || !["queued", "retry"].includes(operation.status)) return;
    // Claim durably; a crash after this point never causes an automatic duplicate send.
    const claimed = await one(
      db,
      "UPDATE custom_dim.operation_jobs SET status='running',attempt_count=attempt_count+1 WHERE id=$1 AND status IN('queued','retry') RETURNING id",
      [operation.id],
    );
    if (!claimed) return;
    try {
      let result: any;
      if (operation.job_type === "audience.execute")
        return await executeAudienceOperation(
          db,
          operation,
          audienceActions(vault, fetch, process.env.APP_ENV === "development"),
          vault,
          fetch,
          reserveRate,
        );
      if (operation.job_type === "email.webhook")
        result = await db.transaction((tx) =>
          processEmailWebhook(tx, operation, vault),
        );
      else if (operation.job_type === "inbox.ingest")
        result = await db.transaction((tx) => normalizeIncoming(tx, operation));
      else if (operation.job_type === "inbox.send") {
        const actor = await loadActor(
          db,
          operation.payload.requested_by,
          operation.organization_id,
          operation.payload.requested_aal || "aal1",
          randomUUID(),
        );
        result = await scoped(db, actor, async (tx) => {
          const conversation = await one(
            tx,
            "SELECT * FROM custom_dim.conversations WHERE id=$1 AND organization_id=$2",
            [operation.subject_id, operation.organization_id],
          );
          demand(conversation, "NOT_FOUND", "Conversa indisponível");
          const { account, provider, template } = await messageGuard(
            tx,
            actor,
            conversation,
            operation.payload.purpose,
            operation.payload.template_id,
            operation.payload.template_parameters || [],
            operation.payload.template_components,
          );
          const integration = await one(
            tx,
            "SELECT * FROM custom_dim.account_integrations WHERE social_account_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now())",
            [account.id],
          );
          demand(integration, "TOKEN_REVOKED", "Conta sem autorização");
          demand(
            integration.secret_ref.startsWith(
              `dim/${actor.organizationId}/${account.id}/`,
            ),
            "VAULT_SCOPE",
            "Referência fora da conta",
            403,
          );
          const secret = await vault.get(integration.secret_ref);
          await reserveRate(provider, account.id);
          const beforeSend = async () => {
            const fresh = await loadActor(
              tx,
              actor.userId,
              actor.organizationId,
              actor.aal,
              randomUUID(),
            );
            await messageGuard(
              tx,
              fresh,
              conversation,
              operation.payload.purpose,
              operation.payload.template_id,
              operation.payload.template_parameters || [],
              operation.payload.template_components,
            );
            demand(
              await one(
                tx,
                "SELECT i.id FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id WHERE i.id=$1 AND i.status='active' AND i.secret_ref=$2 AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp()) AND a.external_id=$3",
                [integration.id, integration.secret_ref, account.external_id],
              ),
              "TOKEN_REVOKED",
              "Autorização mudou durante o envio",
              409,
            );
          };
          if (provider === "whatsapp") await beforeSend();
          const sent =
            provider === "email"
              ? await sendEmailReply(
                  tx,
                  actor,
                  conversation.id,
                  operation.payload,
                  operation.idempotency_key,
                  vault,
                  fetch,
                  beforeSend,
                )
              : provider === "telegram"
                ? await telegram.publish({
                    token: secret.token,
                    destination: conversation.external_thread_id,
                    text: operation.payload.text,
                    idempotencyKey: operation.idempotency_key,
                    beforeSend,
                  })
                : await whatsappSend(
                    secret.token,
                    account.external_id,
                    conversation.external_thread_id,
                    template
                      ? {
                          template: {
                            name: template.provider_template_id,
                            language: { code: template.language },
                            components: templateParameters(
                              template,
                              operation.payload.template_parameters || [],
                              operation.payload.template_components,
                            ),
                          },
                        }
                      : { text: operation.payload.text },
                  );
          await insert(tx, "messages", {
            organization_id: operation.organization_id,
            conversation_id: conversation.id,
            direction: "outgoing",
            body_reference: operation.payload.text,
            provider_message_id: sent.externalId || sent.messages?.[0]?.id,
            status: "sent",
          });
          return { sent: true };
        });
      } else {
        demand(
          process.env.N8N_URL && process.env.N8N_SERVICE_TOKEN,
          "N8N_UNAVAILABLE",
          "Configure n8n central",
        );
        // n8n is given bounded content tasks; OAuth and social credentials never enter this payload.
        const response = await fetch(
          `${process.env.N8N_URL}/webhook/dim/${operation.job_type}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-DIM-Service-Token": process.env.N8N_SERVICE_TOKEN!,
              "Idempotency-Key": operation.id,
            },
            body: JSON.stringify({
              operation_id: operation.id,
              organization_id: operation.organization_id,
              subject_id: operation.subject_id,
              correlation_id: operation.correlation_id,
              payload: operation.payload,
            }),
            signal: AbortSignal.timeout(90000),
          },
        );
        demand(response.ok, "N8N_UNAVAILABLE", "Workflow indisponível", 503);
        result = await response.json();
        // An accepted request is not proof that AI generation or a provider action completed.
        if (!result.completed) {
          await db.query(
            "UPDATE custom_dim.operation_jobs SET status='pending_human',result=$1 WHERE id=$2",
            [JSON.stringify(result), operation.id],
          );
          return result;
        }
      }
      await db.query(
        "UPDATE custom_dim.operation_jobs SET status='completed',result=$1 WHERE id=$2",
        [JSON.stringify(result), operation.id],
      );
      return result;
    } catch (error) {
      const retry = error instanceof ProviderFailure && error.kind === "retry";
      const uncertain = operation.job_type === "inbox.send" && !retry;
      await db.query(
        "UPDATE custom_dim.operation_jobs SET status=$1,last_error=$2 WHERE id=$3",
        [
          retry ? "retry" : uncertain ? "uncertain" : "failed",
          error instanceof ProviderFailure ? error.code : "OPERATION_FAILED",
          operation.id,
        ],
      );
      if (retry) throw error;
      return { failed: true };
    }
  },
  { connection, concurrency: 3, limiter: { max: 10, duration: 1000 } },
);
worker.on("failed", async (job) => {
  if (job && job.attemptsMade >= 5) {
    await dlq.add(job.name, job.data, { jobId: job.id });
    await db.query(
      "UPDATE custom_dim.publication_jobs SET status='failed' WHERE id=$1 AND status='retry'",
      [job.data.id],
    );
    await db.query(
      "UPDATE custom_dim.operation_jobs SET status='failed' WHERE id=$1 AND status='retry'",
      [job.data.id],
    );
  }
});
worker.on("error", () =>
  console.error(JSON.stringify({ event: "worker_error" })),
);
let polling = false;
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    // Persistent outbox + deterministic Bull IDs survive a crash between Redis enqueue and DB acknowledgement.
    const events = (
      await db.query(
        "SELECT * FROM custom_dim.outbox_events WHERE processed_at IS NULL AND event_type<>'audience.receipt' ORDER BY occurred_at LIMIT 100",
      )
    ).rows;
    for (const event of events) {
      if (event.event_type === "social.publish") {
        const publication = await one(
          db,
          "SELECT scheduled_at FROM custom_dim.publication_jobs WHERE id=$1",
          [event.aggregate_id],
        );
        await queue.add(
          "social.publish",
          { id: event.aggregate_id },
          {
            jobId: event.id,
            delay: Math.max(
              0,
              new Date(publication.scheduled_at).getTime() - Date.now(),
            ),
            attempts: 5,
            backoff: { type: "exponential", delay: 30000, jitter: 0.5 },
          },
        );
      } else if (
        [
          "identity.onboard",
          "identity.offboard",
          "identity.audit",
          "content.approve",
          "security.monitor",
          "campaign.track",
        ].includes(event.event_type)
      ) {
        await db.query(
          "INSERT INTO custom_dim.operation_jobs(organization_id,job_type,subject_id,status,payload,idempotency_key,correlation_id) VALUES($1,$2,$3,'queued',$4,$5,$6) ON CONFLICT DO NOTHING",
          [
            event.organization_id,
            event.event_type,
            event.aggregate_id,
            JSON.stringify(event.payload),
            event.event_id,
            event.correlation_id,
          ],
        );
      }
      await db.query(
        "UPDATE custom_dim.outbox_events SET processed_at=now() WHERE id=$1",
        [event.id],
      );
    }
    for (const operation of (
      await db.query(
        "SELECT id,job_type FROM custom_dim.operation_jobs WHERE status IN('queued','retry') AND available_at<=now() LIMIT 100",
      )
    ).rows)
      await queue.add(
        operation.job_type,
        { id: operation.id },
        {
          jobId: operation.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 30000, jitter: 0.5 },
        },
      );
    await db.query(
      "UPDATE custom_dim.publication_jobs SET status='uncertain',last_error='WORKER_LEASE_EXPIRED' WHERE status='publishing' AND lease_until<now()",
    );
    await db.transaction(async (tx) => {
      const stuck = (
        await tx.query(
          "UPDATE custom_dim.operation_jobs SET status='uncertain',last_error='WORKER_STUCK' WHERE status IN('running','executing') AND updated_at<now()-interval '5 minutes' RETURNING id",
        )
      ).rows;
      for (const job of stuck)
        await tx.query(
          "UPDATE custom_dim.agent_runs SET status='failed_reserved' WHERE input_reference=$1 AND status='running'",
          [job.id],
        );
    });
    await connection.set(
      "dim:worker:heartbeat",
      new Date().toISOString(),
      "EX",
      30,
    );
  } catch {
    console.error(JSON.stringify({ event: "worker_poll_failed" }));
  } finally {
    polling = false;
  }
};
let monitoring = false;
const monitor = async () => {
  if (monitoring) return;
  monitoring = true;
  try {
    const outcomes = await Promise.allSettled([
      refreshOAuthIntegrations(db, vault, oauthConfigFromEnvironment()),
      runScheduledInboxEscalations(db),
      monitorAccounts(db, vault, undefined, !!storage?.download),
      collectMetrics(db, vault),
      collectAdditionalMetrics(db, vault),
      pollAudienceActions(
        db,
        audienceActions(vault, fetch, process.env.APP_ENV === "development"),
        audienceProvider(vault, fetch, process.env.APP_ENV === "development"),
      ),
      observeAudienceExecutions(db)
        .then(() => enrichAudienceReceipts(db))
        .then(() =>
          flushAudienceReceipts(
            db,
            audienceActions(
              vault,
              fetch,
              process.env.APP_ENV === "development",
            ),
          ),
        ),
    ]);
    if (outcomes.some((result) => result.status === "rejected"))
      console.error(JSON.stringify({ event: "monitoring_partial_failure" }));
  } catch {
    console.error(JSON.stringify({ event: "monitoring_failed" }));
  } finally {
    monitoring = false;
  }
};
const monitorTimer = setInterval(monitor, 60000);
void monitor();
const timer = setInterval(poll, 5000);
await poll();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    clearInterval(timer);
    clearInterval(monitorTimer);
    await worker.close();
    await queue.close();
    await dlq.close();
    await connection.quit();
    await db.close();
    process.exit(0);
  });
