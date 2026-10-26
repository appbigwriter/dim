import { z } from "zod";
import { demand, type Actor } from "../../contracts/src/index";
import { one, type DB } from "../../db/src/index";
import { type Vault } from "../../connectors/src/index";
import { emailAddress, ResendEmail } from "../../connectors/src/email";
import { audit, hash, resource } from "./security";
import { messageGuard } from "./inbox";
import { operation } from "./editorial";

export const emailReplyInput = z
  .object({
    subject: z
      .string()
      .min(1)
      .max(200)
      .refine((value) => !/[\r\n]/.test(value)),
    text: z.string().min(1).max(30000),
    purpose: z.enum(["marketing", "service"]),
  })
  .strict();
type EmailReply = z.infer<typeof emailReplyInput>;
async function emailGuard(
  db: DB,
  actor: Actor,
  conversationId: string,
  purpose: string,
) {
  const conversation = await resource(
    db,
    "conversations",
    conversationId,
    actor,
  );
  demand(
    await one(
      db,
      `SELECT a.id FROM custom_dim.role_assignments a JOIN custom_dim.role_permissions rp ON rp.role_id=a.role_id JOIN custom_dim.permissions p ON p.id=rp.permission_id JOIN custom_dim.organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id JOIN custom_dim.organizations o ON o.id=a.organization_id WHERE a.organization_id=$1 AND a.user_id=$2 AND m.status='active' AND o.status='active' AND (a.valid_until IS NULL OR a.valid_until>now()) AND p.code IN('inbox.write','*') AND (a.scope_type='organization' OR (a.scope_type='influencer' AND a.scope_id=$3) OR (a.scope_type='account' AND a.scope_id=$4)) LIMIT 1`,
      [
        actor.organizationId,
        actor.userId,
        conversation.influencer_id,
        conversation.social_account_id,
      ],
    ),
    "EMAIL_PERMISSION_REVOKED",
    "Acesso ao envio de e-mail revogado",
    403,
  );
  const { account, provider } = await messageGuard(
    db,
    actor,
    conversation,
    purpose,
  );
  demand(
    provider === "email" &&
      account.influencer_id === conversation.influencer_id,
    "EMAIL_CONVERSATION_REQUIRED",
    "Conversa deve pertencer à conta de e-mail da identidade",
    409,
  );
  const link = await one(
    db,
    "SELECT id FROM custom_dim.contact_influencers WHERE contact_id=$1 AND influencer_id=$2 AND relationship_status='active'",
    [conversation.contact_id, conversation.influencer_id],
  );
  demand(
    link,
    "EMAIL_CONTACT_SCOPE",
    "Contato não vinculado a esta identidade",
    403,
  );
  const recipient = await one(
    db,
    `SELECT * FROM custom_dim.contact_identities WHERE organization_id=$1 AND contact_id=$2 AND platform_id=$3 AND verification_status='verified' AND (id::text=$4 OR external_identifier_hash=$4)`,
    [
      actor.organizationId,
      conversation.contact_id,
      account.platform_id,
      conversation.external_thread_id,
    ],
  );
  demand(
    recipient?.encrypted_reference?.startsWith(
      `dim/${actor.organizationId}/contacts/${conversation.contact_id}/email/`,
    ) && !recipient.encrypted_reference.includes(".."),
    "EMAIL_RECIPIENT_UNVERIFIED",
    "Destinatário verificado não encontrado para esta conversa",
    409,
  );
  if (purpose === "service") {
    const incoming = await one(
      db,
      "SELECT id FROM custom_dim.messages WHERE conversation_id=$1 AND direction='incoming' AND occurred_at>now()-interval '30 days' LIMIT 1",
      [conversation.id],
    );
    demand(
      incoming,
      "EMAIL_SERVICE_WINDOW",
      "Resposta de atendimento exige mensagem recebida nos últimos 30 dias",
      409,
    );
  }
  return { conversation, account, recipient };
}
export async function queueEmailReply(
  db: DB,
  actor: Actor,
  conversationId: string,
  input: unknown,
  key: string,
) {
  const data = emailReplyInput.parse(input);
  await emailGuard(db, actor, conversationId, data.purpose);
  const result = await operation(
    db,
    actor,
    "inbox.send",
    conversationId,
    {
      text: data.text,
      purpose: data.purpose,
      email_subject: data.subject,
      requested_by: actor.userId,
      requested_aal: actor.aal,
    },
    key,
  );
  await audit(db, actor, "email_queued", "conversations", conversationId, {
    purpose: data.purpose,
  });
  return result;
}
/** Run inside the worker's scoped transaction. Contact is locked by messageGuard throughout sending. */
export async function sendEmailReply(
  db: DB,
  actor: Actor,
  conversationId: string,
  input: { text: string; purpose: string; email_subject?: string },
  key: string,
  vault: Vault,
  fetcher: typeof fetch = fetch,
) {
  const data: EmailReply = emailReplyInput.parse({
    text: input.text,
    purpose: input.purpose,
    subject: input.email_subject,
  });
  const first = await emailGuard(db, actor, conversationId, data.purpose);
  const integration = await one(
    db,
    "SELECT * FROM custom_dim.account_integrations WHERE social_account_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now()) FOR SHARE",
    [first.account.id],
  );
  demand(
    integration,
    "EMAIL_AUTH_REVOKED",
    "Conta de e-mail sem autorização",
    403,
  );
  const config = await vault.get(integration.secret_ref);
  const transport = new ResendEmail(config, fetcher);
  await transport.health(first.account.external_id);
  const secret = await vault.get(first.recipient.encrypted_reference);
  const to = emailAddress(secret.email || "");
  demand(
    hash({ provider: "email", identifier: to }) ===
      first.recipient.external_identifier_hash,
    "EMAIL_RECIPIENT_MISMATCH",
    "Endereço diverge do destinatário verificado",
    409,
  );
  // Refresh after all asynchronous credential/health reads, immediately before the send.
  const final = await emailGuard(db, actor, conversationId, data.purpose);
  demand(
    final.recipient.id === first.recipient.id &&
      final.recipient.encrypted_reference ===
        first.recipient.encrypted_reference &&
      final.recipient.external_identifier_hash ===
        first.recipient.external_identifier_hash,
    "EMAIL_RECIPIENT_CHANGED",
    "Destinatário mudou; reveja a conversa",
    409,
  );
  return transport.send({
    destination: final.account.external_id,
    to,
    subject: data.subject,
    text: data.text,
    idempotencyKey: `dim-email:${actor.organizationId}:${key}`,
  });
}
