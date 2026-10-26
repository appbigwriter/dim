import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, one, type DB, type Database } from "../../db/src/index";
import { ProviderFailure, type Vault } from "../../connectors/src/index";
import { emailAddress, ResendEmail } from "../../connectors/src/email";
import { authorize, hash, resource } from "./security";

export function verifyResendWebhook(
  raw: Buffer,
  headers: Record<string, unknown>,
  secret: string,
  now = Date.now(),
) {
  const id = headers["svix-id"],
    timestamp = headers["svix-timestamp"],
    signatures = headers["svix-signature"];
  demand(
    typeof id === "string" &&
      /^[A-Za-z0-9_-]{1,200}$/.test(id) &&
      typeof timestamp === "string" &&
      /^\d{10,12}$/.test(timestamp) &&
      typeof signatures === "string" &&
      signatures.length <= 4096 &&
      raw.length <= 1048576,
    "EMAIL_SIGNATURE_INVALID",
    "Assinatura de webhook inválida",
    401,
  );
  demand(
    Math.abs(now / 1000 - Number(timestamp)) <= 300,
    "EMAIL_SIGNATURE_EXPIRED",
    "Webhook fora da janela de segurança",
    401,
  );
  demand(
    /^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret),
    "EMAIL_WEBHOOK_DISABLED",
    "Configure assinatura do webhook Resend",
    503,
  );
  const key = Buffer.from(secret.slice(6), "base64");
  demand(
    key.length >= 16,
    "EMAIL_WEBHOOK_DISABLED",
    "Chave de assinatura inválida",
    503,
  );
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.`)
    .update(raw)
    .digest();
  const valid = signatures.split(" ").some((signature) => {
    const [version, encoded] = signature.split(",");
    if (version !== "v1" || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      return false;
    const candidate = Buffer.from(encoded, "base64");
    return (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    );
  });
  demand(
    valid,
    "EMAIL_SIGNATURE_INVALID",
    "Assinatura de webhook inválida",
    401,
  );
  return id;
}
const eventInput = z
  .object({
    type: z.enum([
      "email.received",
      "email.sent",
      "email.delivered",
      "email.delivery_delayed",
      "email.bounced",
      "email.complained",
      "email.failed",
      "email.suppressed",
      "email.opened",
      "email.clicked",
    ]),
    created_at: z
      .string()
      .refine((value) => Number.isFinite(Date.parse(value))),
    data: z.object({ email_id: z.uuid() }).passthrough(),
  })
  .passthrough();
async function connection(db: DB, accountId: string, vault: Vault) {
  const row = await one(
    db,
    "SELECT a.*,i.id AS integration_id,i.secret_ref FROM custom_dim.social_accounts a JOIN custom_dim.platforms p ON p.id=a.platform_id JOIN custom_dim.account_integrations i ON i.social_account_id=a.id AND i.status='active' WHERE a.id=$1 AND p.code='email' AND a.account_status='active' AND (i.expires_at IS NULL OR i.expires_at>clock_timestamp())",
    [accountId],
  );
  demand(
    row && row.secret_ref.startsWith(`dim/${row.organization_id}/${row.id}/`),
    "EMAIL_ACCOUNT_UNAVAILABLE",
    "Conta de e-mail indisponível",
    404,
  );
  const secret = await vault.get(row.secret_ref);
  demand(
    secret.provider === "resend",
    "EMAIL_PROVIDER_UNSUPPORTED",
    "Webhook exige integração Resend",
    409,
  );
  return { account: row, secret };
}
export async function ingestEmailWebhook(
  db: Database,
  accountId: string,
  raw: Buffer,
  headers: Record<string, unknown>,
  vault: Vault,
) {
  const { account, secret } = await connection(db, accountId, vault);
  const eventId = verifyResendWebhook(
    raw,
    headers,
    secret.webhook_secret || "",
  );
  const event = eventInput.parse(JSON.parse(raw.toString("utf8")));
  demand(
    new Date(event.created_at).getTime() <= Date.now() + 300000,
    "EMAIL_EVENT_FUTURE",
    "Evento contém data futura",
    400,
  );
  return db.transaction(async (tx) => {
    const current = await one(
      tx,
      "SELECT id FROM custom_dim.account_integrations WHERE id=$1 AND status='active' AND secret_ref=$2 FOR SHARE",
      [account.integration_id, account.secret_ref],
    );
    demand(current, "EMAIL_ACCOUNT_UNAVAILABLE", "Autorização revogada", 409);
    const dedupe = hash({ account: account.id, event: eventId });
    const recorded = await one(
      tx,
      "INSERT INTO custom_dim.webhook_events(organization_id,provider,event_id,dedupe_hash,signature_status) VALUES($1,'email',$2,$3,'valid') ON CONFLICT DO NOTHING RETURNING id",
      [account.organization_id, `${account.id}:${eventId}`, dedupe],
    );
    if (!recorded) return { accepted: true, replay: true };
    await insert(tx, "operation_jobs", {
      organization_id: account.organization_id,
      subject_id: account.id,
      job_type: "email.webhook",
      status: "queued",
      idempotency_key: `email-webhook:${dedupe}`,
      payload: {
        event_id: recorded.id,
        email_id: event.data.email_id,
        type: event.type,
        occurred_at: event.created_at,
      },
    });
    return { accepted: true, replay: false };
  });
}
function mailbox(value: unknown) {
  demand(
    typeof value === "string" && value.length <= 1024 && !/[\r\n]/.test(value),
    "EMAIL_ADDRESS_INVALID",
    "Endereço recebido inválido",
    409,
  );
  const angle = value.match(/^[^<>]*<([^<>]+)>$/);
  return emailAddress(angle ? angle[1] : value);
}
const ranks: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};
export async function processEmailWebhook(
  db: DB,
  job: any,
  vault: Vault,
  fetcher: typeof fetch = fetch,
) {
  const { account, secret } = await connection(db, job.subject_id, vault);
  demand(
    account.organization_id === job.organization_id,
    "EMAIL_TENANT_MISMATCH",
    "Evento de outra organização",
    403,
  );
  const transport = new ResendEmail(secret, fetcher);
  const providerId = z.uuid().parse(job.payload.email_id);
  const event = await one(
    db,
    "SELECT id,processing_state FROM custom_dim.webhook_events WHERE id=$1 AND organization_id=$2 AND provider='email' AND signature_status='valid'",
    [job.payload.event_id, account.organization_id],
  );
  demand(
    event,
    "EMAIL_EVENT_UNVERIFIED",
    "Evento sem assinatura verificada",
    403,
  );
  if (event.processing_state === "processed") return { replay: true };
  const canonicalAccount = emailAddress(account.external_id);
  const verifyCurrent = async () =>
    demand(
      await one(
        db,
        "SELECT i.id FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id WHERE i.id=$1 AND i.status='active' AND i.secret_ref=$2 AND a.account_status='active' AND a.external_id=$3 FOR SHARE OF i,a",
        [account.integration_id, account.secret_ref, account.external_id],
      ),
      "EMAIL_ACCOUNT_REVOKED",
      "Conta revogada durante leitura do evento",
      409,
    );
  if (job.payload.type === "email.received") {
    await transport.receivingHealth(canonicalAccount);
    const received = await transport.received(providerId);
    demand(
      received.id === providerId &&
        Array.isArray(received.to) &&
        received.to.map(mailbox).includes(canonicalAccount),
      "EMAIL_DESTINATION_MISMATCH",
      "E-mail recebido pertence a outra conta",
      403,
    );
    await verifyCurrent();
    const sender = mailbox(received.from),
      identifierHash = hash({ provider: "email", identifier: sender });
    let identity = await one(
      db,
      "SELECT * FROM custom_dim.contact_identities WHERE organization_id=$1 AND platform_id=$2 AND external_identifier_hash=$3",
      [account.organization_id, account.platform_id, identifierHash],
    );
    if (!identity) {
      const contact = await insert(db, "contacts", {
        organization_id: account.organization_id,
        display_name: `Contato ${identifierHash.slice(0, 8)}`,
        locale: "pt-BR",
      });
      const ref = `dim/${account.organization_id}/contacts/${contact.id}/email/${randomUUID()}`;
      identity = await one(
        db,
        "INSERT INTO custom_dim.contact_identities(organization_id,contact_id,platform_id,external_identifier_hash,encrypted_reference,verification_status) VALUES($1,$2,$3,$4,$5,'unverified') ON CONFLICT DO NOTHING RETURNING *",
        [
          account.organization_id,
          contact.id,
          account.platform_id,
          identifierHash,
          ref,
        ],
      );
      if (identity) await vault.put(ref, { email: sender });
      else {
        await db.query("DELETE FROM custom_dim.contacts WHERE id=$1", [
          contact.id,
        ]);
        identity = await one(
          db,
          "SELECT * FROM custom_dim.contact_identities WHERE organization_id=$1 AND platform_id=$2 AND external_identifier_hash=$3",
          [account.organization_id, account.platform_id, identifierHash],
        );
        demand(
          identity,
          "EMAIL_CONTACT_RACE",
          "Contato mudou durante processamento",
          409,
        );
      }
    }
    const contact = await one(
      db,
      "SELECT status FROM custom_dim.contacts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
      [identity.contact_id, account.organization_id],
    );
    demand(contact, "EMAIL_CONTACT_MISSING", "Contato indisponível", 409);
    if (["erased", "restricted"].includes(contact.status)) {
      await db.query(
        "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
        [event.id],
      );
      return { suppressed: true };
    }
    await db.query(
      "INSERT INTO custom_dim.contact_influencers(organization_id,contact_id,influencer_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [account.organization_id, identity.contact_id, account.influencer_id],
    );
    let conversation = await one(
      db,
      "SELECT id FROM custom_dim.conversations WHERE social_account_id=$1 AND contact_id=$2 AND external_thread_id=$3 AND status='open'",
      [account.id, identity.contact_id, identity.id],
    );
    if (!conversation) {
      conversation = await one(
        db,
        "INSERT INTO custom_dim.conversations(organization_id,influencer_id,social_account_id,contact_id,external_thread_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
        [
          account.organization_id,
          account.influencer_id,
          account.id,
          identity.contact_id,
          identity.id,
        ],
      );
      if (!conversation)
        conversation = await one(
          db,
          "SELECT id FROM custom_dim.conversations WHERE organization_id=$1 AND social_account_id=$2 AND external_thread_id=$3 AND status='open'",
          [account.organization_id, account.id, identity.id],
        );
      demand(
        conversation,
        "EMAIL_THREAD_RACE",
        "Conversa mudou durante processamento",
        409,
      );
    }
    const authenticated =
      received.authentication?.dmarc === "pass" &&
      (received.authentication?.spf === "pass" ||
        received.authentication?.dkim === "pass");
    const text =
      typeof received.text === "string"
        ? received.text.slice(0, 30000)
        : "[Mensagem sem texto simples. HTML e anexos não são executados.]";
    const incoming = await one(
      db,
      "INSERT INTO custom_dim.messages(organization_id,conversation_id,provider_message_id,direction,message_type,body_reference,status,occurred_at) VALUES($1,$2,$3,'incoming',$4,$5,'received',$6) ON CONFLICT DO NOTHING RETURNING id",
      [
        account.organization_id,
        conversation.id,
        providerId,
        authenticated ? "email_authenticated" : "email_unverified_sender",
        `Assunto: ${String(received.subject || "").slice(0, 200)}\n\n${text}`,
        job.payload.occurred_at,
      ],
    );
    if (incoming)
      await db.query(
        "UPDATE custom_dim.conversations SET unread_count=unread_count+1,sla_due_at=COALESCE(sla_due_at,clock_timestamp()+interval '24 hours') WHERE id=$1",
        [conversation.id],
      );
    await db.query(
      "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
      [event.id],
    );
    return {
      conversation_id: conversation.id,
      sender_verified: identity.verification_status === "verified",
      authenticated,
    };
  }
  const message = await one(
    db,
    "SELECT m.id,m.status,c.contact_id FROM custom_dim.messages m JOIN custom_dim.conversations c ON c.id=m.conversation_id WHERE m.organization_id=$1 AND m.direction='outgoing' AND m.provider_message_id=$2 AND c.social_account_id=$3",
    [account.organization_id, providerId, account.id],
  );
  if (!message) throw new ProviderFailure("retry", "EMAIL_MESSAGE_PENDING", 30);
  const sent = await transport.sent(providerId);
  demand(
    sent.id === providerId && mailbox(sent.from) === canonicalAccount,
    "EMAIL_DESTINATION_MISMATCH",
    "Recibo de outra conta remetente",
    403,
  );
  await verifyCurrent();
  const status = [
    "email.bounced",
    "email.complained",
    "email.failed",
    "email.suppressed",
  ].includes(job.payload.type)
    ? "failed"
    : ["email.opened", "email.clicked"].includes(job.payload.type)
      ? "read"
      : job.payload.type === "email.delivered"
        ? "delivered"
        : "sent";
  if ((ranks[status] || 0) >= (ranks[message.status] || 0))
    await db.query("UPDATE custom_dim.messages SET status=$1 WHERE id=$2", [
      status,
      message.id,
    ]);
  await db.query(
    "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
    [event.id],
  );
  return { delivery_updated: true, status };
}
export async function emailDeliveryFacts(
  db: DB,
  actor: Actor,
  influencerId: string,
) {
  await resource(db, "influencers", influencerId, actor);
  authorize(actor, "inbox.read", { influencerId });
  const rows = (
    await db.query(
      "SELECT j.payload->>'type' AS event,count(DISTINCT j.payload->>'email_id')::int AS messages FROM custom_dim.operation_jobs j JOIN custom_dim.social_accounts a ON a.id=j.subject_id JOIN custom_dim.webhook_events e ON e.id=(j.payload->>'event_id')::uuid WHERE j.organization_id=$1 AND a.influencer_id=$2 AND j.job_type='email.webhook' AND e.signature_status='valid' AND e.processing_state='processed' GROUP BY j.payload->>'type'",
      [actor.organizationId, influencerId],
    )
  ).rows;
  return {
    provenance: "resend_signed_webhooks_with_api_readback",
    observed: rows,
    missing_events_are_unknown: true,
  };
}
