import { z } from "zod";
import { demand, text, uuid, type Actor } from "../../contracts/src/index";
import { insert, one, type DB } from "../../db/src/index";
import { audit, authorize, hash, member, resource } from "./security";
import { operation } from "./editorial";
import {
  templateParameters,
  templateComponentInput,
  type TemplateComponentInput,
} from "../../connectors/src/templates";
import { ProviderFailure } from "../../connectors/src/index";
export async function ingest(
  db: DB,
  organizationId: string,
  account: any,
  provider: string,
  payload: any,
) {
  const events: any[] = [];
  if (provider === "telegram" && payload.message) {
    demand(
      String(payload.message.chat?.id) === account.external_id,
      "DESTINATION_MISMATCH",
      "Webhook de outro chat",
      403,
    );
    events.push({
      id: String(payload.update_id),
      sender: String(payload.message.from.id),
      thread: String(payload.message.chat.id),
      text: String(payload.message.text || ""),
      date: new Date(payload.message.date * 1000).toISOString(),
    });
  }
  if (provider === "whatsapp")
    for (const entry of payload.entry || [])
      for (const change of entry.changes || []) {
        demand(
          change.value?.metadata?.phone_number_id === account.external_id,
          "DESTINATION_MISMATCH",
          "Número de outra conta",
          403,
        );
        for (const message of change.value.messages || [])
          events.push({
            id: String(message.id),
            sender: String(message.from),
            thread: String(message.from),
            text: String(message.text?.body || ""),
            date: new Date(Number(message.timestamp) * 1000).toISOString(),
          });
        for (const delivery of change.value.statuses || [])
          if (["sent", "delivered", "read", "failed"].includes(delivery.status))
            events.push({
              kind: "delivery",
              id: `${delivery.id}:${delivery.status}`,
              messageId: String(delivery.id),
              status: delivery.status,
            });
      }
  for (const incoming of events) {
    const dedupe = hash({ account: account.id, event: incoming.id });
    const created = await one(
      db,
      `INSERT INTO custom_dim.webhook_events(organization_id,provider,event_id,dedupe_hash,signature_status) VALUES($1,$2,$3,$4,'valid') ON CONFLICT DO NOTHING RETURNING id`,
      [organizationId, provider, `${account.id}:${incoming.id}`, dedupe],
    );
    if (!created) continue;
    // The webhook returns after persisting to the durable queue. No LLM receives administrative tools.
    await insert(db, "operation_jobs", {
      organization_id: organizationId,
      job_type: "inbox.ingest",
      subject_id: account.id,
      status: "queued",
      idempotency_key: `webhook-${dedupe}`,
      payload: { incoming, provider, event_id: created.id },
    });
  }
  return { accepted: true };
}
export async function normalizeIncoming(db: DB, job: any) {
  const account = await one(
    db,
    "SELECT * FROM custom_dim.social_accounts WHERE id=$1 AND organization_id=$2",
    [job.subject_id, job.organization_id],
  );
  demand(account, "ACCOUNT_MISSING", "Conta removida");
  const { incoming, provider } = job.payload;
  if (incoming.kind === "delivery") {
    const existing = await one(
      db,
      "SELECT m.id FROM custom_dim.messages m JOIN custom_dim.conversations c ON c.id=m.conversation_id WHERE m.organization_id=$1 AND m.provider_message_id=$2 AND c.social_account_id=$3",
      [job.organization_id, incoming.messageId, account.id],
    );
    if (!existing)
      throw new ProviderFailure("retry", "DELIVERY_MESSAGE_PENDING", 30);
    await db.query(
      "UPDATE custom_dim.messages SET status=$1 WHERE id=$2 AND (CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 END)>=(CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)",
      [incoming.status, existing.id],
    );
    await db.query(
      "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
      [job.payload.event_id],
    );
    return { delivery_updated: true };
  }
  const identifierHash = hash({ provider, identifier: incoming.sender });
  let contact = await one(
    db,
    "SELECT contact_id AS id FROM custom_dim.contact_identities WHERE organization_id=$1 AND platform_id=$2 AND external_identifier_hash=$3",
    [job.organization_id, account.platform_id, identifierHash],
  );
  if (!contact) {
    contact = await insert(db, "contacts", {
      organization_id: job.organization_id,
      display_name: `Contato ${identifierHash.slice(0, 8)}`,
      locale: "pt-BR",
    });
    await insert(db, "contact_identities", {
      organization_id: job.organization_id,
      contact_id: contact.id,
      platform_id: account.platform_id,
      external_identifier_hash: identifierHash,
    });
    await insert(db, "contact_influencers", {
      organization_id: job.organization_id,
      contact_id: contact.id,
      influencer_id: account.influencer_id,
    });
  }
  const currentContact = await one(
    db,
    "SELECT status FROM custom_dim.contacts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [contact.id, job.organization_id],
  );
  if (
    currentContact?.status === "erased" ||
    currentContact?.status === "restricted"
  ) {
    await db.query(
      "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
      [job.payload.event_id],
    );
    // Keep the suppression hash to prevent silently recreating an erased contact.
    await db.query(
      "UPDATE custom_dim.operation_jobs SET payload=jsonb_build_object('event_id',$1::text,'suppressed',true) WHERE id=$2",
      [job.payload.event_id, job.id],
    );
    return { suppressed: true };
  }
  let conversation = await one(
    db,
    "SELECT * FROM custom_dim.conversations WHERE organization_id=$1 AND social_account_id=$2 AND external_thread_id=$3 AND status='open'",
    [job.organization_id, account.id, incoming.thread],
  );
  if (!conversation)
    conversation = await insert(db, "conversations", {
      organization_id: job.organization_id,
      influencer_id: account.influencer_id,
      social_account_id: account.id,
      contact_id: contact.id,
      external_thread_id: incoming.thread,
    });
  const inserted = await db.query(
    `INSERT INTO custom_dim.messages(organization_id,conversation_id,provider_message_id,direction,body_reference,occurred_at) VALUES($1,$2,$3,'incoming',$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
    [
      job.organization_id,
      conversation.id,
      incoming.id,
      incoming.text,
      incoming.date,
    ],
  );
  if (inserted.rows.length) {
    const policy = await one(
      db,
      "SELECT settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='inbox'",
      [job.organization_id],
    );
    const hours = Number(policy?.settings.sla_hours || 24);
    await db.query(
      "UPDATE custom_dim.conversations SET unread_count=unread_count+1,sla_due_at=COALESCE(sla_due_at,now()+($1::text||' hours')::interval) WHERE id=$2",
      [hours, conversation.id],
    );
  }
  await db.query(
    "UPDATE custom_dim.webhook_events SET processing_state='processed' WHERE id=$1",
    [job.payload.event_id],
  );
  return { conversation_id: conversation.id };
}
export async function messageGuard(
  db: DB,
  actor: Actor,
  conversation: any,
  purpose: string,
  templateId?: string,
  parameters: string[] = [],
  components: TemplateComponentInput = {},
) {
  authorize(actor, "inbox.write", {
    influencerId: conversation.influencer_id,
    accountId: conversation.social_account_id,
  });
  await db.query(
    "SELECT id FROM custom_dim.contacts WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    [conversation.contact_id, actor.organizationId],
  );
  const contact = await resource(
    db,
    "contacts",
    conversation.contact_id,
    actor,
  );
  demand(
    contact.status === "active",
    "CONTACT_BLOCKED",
    "Contato indisponível",
  );
  const account = await resource(
    db,
    "social_accounts",
    conversation.social_account_id,
    actor,
  );
  const identity = await resource(
    db,
    "influencers",
    conversation.influencer_id,
    actor,
  );
  demand(
    identity.status === "active",
    "IDENTITY_INACTIVE",
    "Atendimento suspenso para esta identidade",
  );
  const platform = await one(
    db,
    "SELECT code FROM custom_dim.platforms WHERE id=$1",
    [account.platform_id],
  );
  const consent = await one(
    db,
    `SELECT * FROM custom_dim.consent_records c WHERE organization_id=$1 AND contact_id=$2 AND channel=$3 AND purpose=$4 AND granted_at<=now() AND NOT EXISTS(SELECT 1 FROM custom_dim.consent_records r WHERE r.supersedes_id=c.id) ORDER BY granted_at DESC,created_at DESC LIMIT 1`,
    [actor.organizationId, contact.id, platform.code, purpose],
  );
  if (purpose === "marketing")
    demand(
      consent &&
        !consent.revoked_at &&
        (!consent.expires_at || new Date(consent.expires_at) > new Date()),
      "OPT_OUT",
      "Sem opt-in de marketing vigente",
      403,
    );
  demand(
    account.account_status === "active" &&
      account.integration_status === "connected",
    "ACCOUNT_DISCONNECTED",
    "Conta não conectada",
  );
  demand(
    await one(
      db,
      "SELECT id FROM custom_dim.account_capabilities WHERE social_account_id=$1 AND capability_code='send_messages' AND available=true AND checked_at>now()-interval '24 hours'",
      [account.id],
    ),
    "CAPABILITY_UNAVAILABLE",
    "Envio de mensagens não autorizado",
  );
  if (platform.code === "whatsapp") {
    const last = await one(
      db,
      "SELECT occurred_at FROM custom_dim.messages WHERE conversation_id=$1 AND direction='incoming' ORDER BY occurred_at DESC LIMIT 1",
      [conversation.id],
    );
    const policy = await one(
      db,
      "SELECT settings FROM custom_dim.organization_settings WHERE organization_id=$1 AND module_key='inbox'",
      [actor.organizationId],
    );
    const inWindow =
      last &&
      Date.now() - new Date(last.occurred_at).getTime() <
        Number(policy?.settings.whatsapp_window_hours || 24) * 3600000;
    if (!inWindow || purpose === "marketing" || templateId) {
      demand(
        templateId,
        "TEMPLATE_REQUIRED",
        "Fora da janela permitida, use template aprovado",
      );
      const template = await resource(
        db,
        "message_templates",
        templateId,
        actor,
      );
      demand(
        template.content?.social_account_id === account.id &&
          Date.now() - new Date(template.content?.synced_at || 0).getTime() <
            86400000,
        "TEMPLATE_STALE",
        "Sincronize o template aprovado desta conta",
      );
      demand(
        String(template.category).toLowerCase() !== "marketing" ||
          purpose === "marketing",
        "MARKETING_PURPOSE_REQUIRED",
        "Template de marketing exige finalidade e opt-in correspondentes",
      );
      demand(
        template.provider === "whatsapp" &&
          template.approval_status === "approved" &&
          template.provider_template_id,
        "TEMPLATE_UNAPPROVED",
        "Template sem aprovação do provedor",
      );
      templateParameters(template, parameters, components);
      return { account, provider: platform.code, template };
    }
  }
  return { account, provider: platform.code, template: null };
}
export async function sendMessage(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
  key: string,
) {
  const data = z
    .object({
      text: text,
      purpose: z.enum(["service", "marketing"]),
      template_id: uuid.optional(),
      template_parameters: z.array(text).max(30).default([]),
      template_components: templateComponentInput.optional(),
    })
    .strict()
    .parse(input);
  const conversation = await resource(db, "conversations", id, actor);
  await messageGuard(
    db,
    actor,
    conversation,
    data.purpose,
    data.template_id,
    data.template_parameters,
    data.template_components,
  );
  const result = await operation(
    db,
    actor,
    "inbox.send",
    id,
    { ...data, requested_by: actor.userId, requested_aal: actor.aal },
    key,
  );
  await audit(db, actor, "message_queued", "conversations", id, {
    purpose: data.purpose,
  });
  return result;
}
export async function handoff(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const data = z
    .object({
      assigned_to: uuid,
      status: z.enum(["open", "closed"]).default("open"),
      note: text.optional(),
    })
    .strict()
    .parse(input);
  const conversation = await resource(db, "conversations", id, actor);
  authorize(actor, "inbox.write", { influencerId: conversation.influencer_id });
  await member(db, actor, data.assigned_to);
  await db.query(
    "UPDATE custom_dim.conversations SET assigned_to=$1,status=$2 WHERE id=$3",
    [data.assigned_to, data.status, id],
  );
  await insert(db, "conversation_assignments", {
    organization_id: actor.organizationId,
    conversation_id: id,
    user_id: data.assigned_to,
  });
  if (data.note)
    await insert(db, "conversation_notes", {
      organization_id: actor.organizationId,
      conversation_id: id,
      author_id: actor.userId,
      note_body: data.note,
    });
  await audit(db, actor, "handoff", "conversations", id, {
    assigned_to: data.assigned_to,
    status: data.status,
  });
  return { transferred: true };
}
