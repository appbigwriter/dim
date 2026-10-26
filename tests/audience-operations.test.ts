import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { audienceFixture } from "./audience-fixture";
import { assignRole } from "../packages/db/src/seed";
import { loadActor } from "../packages/core/src/access";
import { createResource } from "../packages/core/src/resources";
import { scoped, hash } from "../packages/core/src/security";
import { bindAudience, syncAudience } from "../packages/core/src/audience";
import {
  importAudienceAction,
  scheduleAudienceExecution,
  executionReceipt,
  enrichAudienceReceipts,
} from "../packages/core/src/audience-execution";
import { executeAudienceOperation } from "../packages/core/src/audience-operations";
import { approve, schedule } from "../packages/core/src/editorial";
import {
  audienceActionHash,
  type AudienceAction,
} from "../packages/contracts/src/audience-actions";
import { AppError } from "../packages/contracts/src/index";
import { insert, one } from "../packages/db/src/index";
import type { AudienceActions } from "../packages/connectors/src/audience-actions";
import type { Vault } from "../packages/connectors/src/index";

const binding = {
  tenant_id: "audience-tenant-a",
  project_id: "audience-project-a",
  persona_id: "persona-a",
};
const domainId = "11111111-1111-4111-8111-111111111111";
async function setup(
  channel: "crm" | "telegram" | "whatsapp" | "email",
  options: { foreignContact?: boolean; factualPolicy?: boolean } = {},
) {
  const f = await fixture();
  await assignRole(f.db, f.org.id, f.editor, "audience_executor");
  const actor = await loadActor(f.db, f.editor, f.org.id, "aal1", randomUUID());
  const identity = await scoped(f.db, f.actor, (tx) =>
    createResource(tx, f.actor, "influencers", {
      public_name: "Operations test",
      internal_name: "Operations test",
      slug: `operations-${randomUUID()}`,
      type: "virtual",
      owner_user_id: f.admin,
    }),
  );
  await scoped(f.db, f.actor, (tx) =>
    bindAudience(tx, f.actor, identity.id, binding),
  );
  await syncAudience(f.db, f.actor, identity.id, async () => audienceFixture());
  await f.db.query(
    "UPDATE custom_dim.influencers SET status='active' WHERE id=$1",
    [identity.id],
  );
  await insert(f.db, "identity_disclosures", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    disclosure_type: "synthetic",
    disclosure_text: "Persona virtual",
  });
  await insert(f.db, "approval_policies", {
    organization_id: f.org.id,
    code: "operations",
    version: 1,
    resource_type: "content",
    conditions: {
      required_approvals: 1,
      ...(options.factualPolicy
        ? {
            risk: {
              allowedSourceDomains: [],
              requireSourceEvidence: true,
              requireFactualReview: true,
              maxEvidenceAgeHours: 24,
            },
          }
        : {}),
    },
  });
  const contact = await insert(f.db, "contacts", {
    organization_id: f.org.id,
    display_name: "Original contact",
    status: "active",
  });
  const crmTarget = options.foreignContact
    ? await insert(f.db, "contacts", {
        organization_id: f.other.id,
        display_name: "Foreign contact",
        status: "active",
      })
    : contact;
  await insert(f.db, "contact_influencers", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    contact_id: contact.id,
  });
  let account: any, conversation: any;
  if (channel !== "crm") {
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code=$1",
      [channel],
    );
    const connector = await one(
      f.db,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
      [platform.id],
    );
    account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "profile",
      account_status: "active",
      integration_status: "connected",
      external_id: channel === "email" ? "sender@example.org" : "123456",
    });
    await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "api_key",
      status: "active",
      secret_ref: `dim/${f.org.id}/${account.id}/token`,
    });
    await insert(f.db, "account_capabilities", {
      organization_id: f.org.id,
      social_account_id: account.id,
      capability_code: "send_messages",
      available: true,
      checked_at: new Date().toISOString(),
    });
    let externalThread = "5511999999999";
    if (channel === "email") {
      const recipient = await insert(f.db, "contact_identities", {
        organization_id: f.org.id,
        contact_id: contact.id,
        platform_id: platform.id,
        external_identifier_hash: hash({
          provider: "email",
          identifier: "reader@example.net",
        }),
        encrypted_reference: `dim/${f.org.id}/contacts/${contact.id}/email/${randomUUID()}`,
        verification_status: "verified",
      });
      externalThread = recipient.id;
    }
    conversation = await insert(f.db, "conversations", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      social_account_id: account.id,
      contact_id: contact.id,
      external_thread_id: externalThread,
    });
    if (channel === "whatsapp")
      await insert(f.db, "messages", {
        organization_id: f.org.id,
        conversation_id: conversation.id,
        direction: "incoming",
        body_reference: "Requested service",
        occurred_at: new Date().toISOString(),
      });
    else
      await insert(f.db, "consent_records", {
        organization_id: f.org.id,
        contact_id: contact.id,
        channel,
        purpose: "marketing",
        lawful_basis: "consent",
        evidence_ref: "test-only-optin",
        granted_at: new Date(Date.now() - 1000).toISOString(),
      });
  }
  const now = Date.now();
  const action: AudienceAction = {
    contractId: "dim.audience-action.v1",
    ...{
      tenantId: binding.tenant_id,
      projectId: binding.project_id,
      personaId: binding.persona_id,
    },
    actionId: `operations-${randomUUID()}`,
    contextVersion: 1,
    contextHash: audienceFixture().contextHash,
    kind: channel === "crm" ? "crm_update" : "message",
    channel,
    ...(account
      ? {
          targetAccountId: account.id,
          message: {
            conversationId: conversation.id,
            purpose:
              channel === "whatsapp"
                ? ("service" as const)
                : ("marketing" as const),
          },
        }
      : {
          crm: {
            contactId: crmTarget.id,
            patch: { displayName: "Approved new name", locale: "en" as const },
          },
        }),
    content: {
      text: "Persona virtual. Resposta solicitada.",
      title: "Approved subject",
      mediaAssetIds: [],
      sourceUrls: [],
      language: "pt-BR",
    },
    scheduledAt: new Date(now - 1000).toISOString(),
    approval: {
      approvalId: "operations-approval",
      approvedBy: "source-reviewer",
      approvedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
    },
    idempotencyKey: `operations-key-${randomUUID()}`,
    actionHash: "",
  };
  action.actionHash = audienceActionHash(action);
  let revoked = false;
  const source: AudienceActions = {
    list: async () => [action],
    get: async () => {
      if (revoked)
        throw new AppError(410, "AUDIENCE_ACTION_REVOKED", "Revogada");
      return action;
    },
    receipt: async () => {},
  };
  const imported = await importAudienceAction(
    f.db,
    actor,
    identity.id,
    action.actionId,
    source,
  );
  await scoped(f.db, f.reviewActor, (tx) =>
    approve(tx, f.reviewActor, imported.content_id, {
      content_version_id: imported.content_version_id,
      decision: "approved",
      rationale: "Independent operation review",
    }),
  );
  const queue = () =>
    scoped(f.db, actor, (tx) =>
      scheduleAudienceExecution(tx, actor, imported.execution_id),
    );
  const claim = async () => {
    const job = await queue();
    await f.db.query(
      "UPDATE custom_dim.operation_jobs SET status='running' WHERE id=$1",
      [job.id],
    );
    return one(f.db, "SELECT * FROM custom_dim.operation_jobs WHERE id=$1", [
      job.id,
    ]);
  };
  const vault: Vault = {
    get: async (ref: string): Promise<Record<string, string>> =>
      ref.includes("/contacts/")
        ? { email: "reader@example.net" }
        : channel === "email"
          ? {
              provider: "resend",
              token: "re_local_only",
              domain_id: domainId,
              from_email: "sender@example.org",
            }
          : { token: "123:fixture-token" },
    put: async () => {},
  };
  return {
    ...f,
    actor,
    identity,
    contact,
    account,
    conversation,
    action,
    source,
    imported,
    queue,
    claim,
    vault,
    revoke: () => {
      revoked = true;
    },
  };
}

test("CRM approved operation applies once, ignores forged caller assurance, and terminal replay performs no mutation", async () => {
  const f = await setup("crm", { factualPolicy: true });
  try {
    const job = await f.claim();
    const forgedArgument = {
      ...job,
      payload: { requested_by: f.admin, requested_aal: "aal2" },
    };
    assert.deepEqual(
      await executeAudienceOperation(f.db, forgedArgument, f.source, f.vault),
      { completed: true, externalId: undefined },
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT display_name FROM custom_dim.contacts WHERE id=$1",
          [f.contact.id],
        )
      ).display_name,
      "Approved new name",
    );
    assert.deepEqual(
      await executeAudienceOperation(f.db, job, f.source, f.vault),
      { skipped: true },
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT id FROM custom_dim.audit_logs WHERE action='audience_crm_updated'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT last_status FROM custom_dim.audience_execution_requests WHERE id=$1",
          [f.imported.execution_id],
        )
      ).last_status,
      "succeeded",
    );
  } finally {
    await f.db.close();
  }
});

test("CRM rechecks source revocation and does not allow reviewer execution", async () => {
  const f = await setup("crm");
  try {
    await assert.rejects(
      () =>
        scoped(f.db, f.reviewActor, (tx) =>
          scheduleAudienceExecution(tx, f.reviewActor, f.imported.execution_id),
        ),
      (error: any) => error.code === "FORBIDDEN",
    );
    const job = await f.claim();
    f.revoke();
    assert.deepEqual(
      await executeAudienceOperation(f.db, job, f.source, f.vault),
      { status: "blocked", code: "AUDIENCE_ACTION_REVOKED" },
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT display_name FROM custom_dim.contacts WHERE id=$1",
          [f.contact.id],
        )
      ).display_name,
      "Original contact",
    );
  } finally {
    await f.db.close();
  }
});

test("CRM operation cannot target a contact from another tenant even with a valid source approval", async () => {
  const f = await setup("crm", { foreignContact: true });
  try {
    await assert.rejects(f.queue, (error: any) => error.code === "NOT_FOUND");
    assert.equal(
      (
        await f.db.query(
          "SELECT id FROM custom_dim.operation_jobs WHERE job_type='audience.execute'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("Telegram and WhatsApp approved messages reserve quota and send exactly once across operation replay", async () => {
  const originalFetch = globalThis.fetch,
    priorVersion = process.env.WHATSAPP_GRAPH_VERSION;
  try {
    process.env.WHATSAPP_GRAPH_VERSION = "v25.0";
    for (const channel of ["telegram", "whatsapp"] as const) {
      const f = await setup(channel);
      let sent = 0,
        reserved = 0;
      try {
        globalThis.fetch = (async () => {
          sent++;
          return Response.json(
            channel === "telegram"
              ? { ok: true, result: { message_id: 77 } }
              : { messages: [{ id: "wa-message-77" }] },
          );
        }) as typeof fetch;
        const job = await f.claim();
        assert.deepEqual(
          await executeAudienceOperation(
            f.db,
            job,
            f.source,
            f.vault,
            fetch,
            async (provider, account) => {
              assert.equal(provider, channel);
              assert.equal(account, f.account.id);
              reserved++;
            },
          ),
          {
            completed: true,
            externalId: channel === "telegram" ? "77" : "wa-message-77",
          },
        );
        assert.deepEqual(
          await executeAudienceOperation(f.db, job, f.source, f.vault),
          { skipped: true },
        );
        assert.equal(sent, 1);
        assert.equal(reserved, 1);
        assert.equal(
          (
            await f.db.query(
              "SELECT id FROM custom_dim.messages WHERE conversation_id=$1 AND direction='outgoing'",
              [f.conversation.id],
            )
          ).rows.length,
          1,
        );
      } finally {
        await f.db.close();
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (priorVersion === undefined) delete process.env.WHATSAPP_GRAPH_VERSION;
    else process.env.WHATSAPP_GRAPH_VERSION = priorVersion;
  }
});

test("email source revocation after domain health prevents the external mutation", async () => {
  const f = await setup("email");
  let writes = 0,
    reserves = 0;
  try {
    const job = await f.claim();
    const fetcher = (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes++;
        return Response.json({ id: randomUUID() });
      }
      f.revoke();
      return Response.json({
        id: domainId,
        name: "example.org",
        status: "verified",
        capabilities: { sending: "enabled" },
      });
    }) as typeof fetch;
    assert.deepEqual(
      await executeAudienceOperation(
        f.db,
        job,
        f.source,
        f.vault,
        fetcher,
        async () => {
          reserves++;
        },
      ),
      { status: "blocked", code: "AUDIENCE_ACTION_REVOKED" },
    );
    assert.equal(writes, 0);
    assert.equal(reserves, 0);
  } finally {
    await f.db.close();
  }
});

test("concurrent Telegram execution reloads the locked result and performs only one external mutation", async () => {
  const f = await setup("telegram"),
    originalFetch = globalThis.fetch;
  let sent = 0;
  try {
    globalThis.fetch = (async () => {
      sent++;
      return Response.json({ ok: true, result: { message_id: 88 } });
    }) as typeof fetch;
    const job = await f.claim();
    const results = await Promise.all([
      executeAudienceOperation(f.db, job, f.source, f.vault),
      executeAudienceOperation(f.db, job, f.source, f.vault),
    ]);
    assert.equal(
      results.filter((result) => "completed" in result && result.completed)
        .length,
      1,
    );
    assert.equal(
      results.filter((result) => "skipped" in result && result.skipped).length,
      1,
    );
    assert.equal(sent, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await f.db.close();
  }
});

test("approved conversation cannot be redirected into a public channel by the publication scheduler", async () => {
  const f = await setup("telegram");
  try {
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          schedule(
            tx,
            f.actor,
            {
              social_account_id: f.account.id,
              content_version_id: f.imported.content_version_id,
              scheduled_at: f.action.scheduledAt,
            },
            `audience:${f.imported.execution_id}`,
          ),
        ),
      (e: any) => e.code === "AUDIENCE_ACTION_KIND",
    );
    assert.equal(
      (await f.db.query("SELECT id FROM custom_dim.publication_jobs")).rows
        .length,
      0,
    );
  } finally {
    await f.db.close();
  }
});

test("success receipts enrich exact attributable costs, remain idempotent and reject invalid evidence", async () => {
  const f = await setup("crm");
  try {
    const job = await f.claim();
    await executeAudienceOperation(f.db, job, f.source, f.vault);
    await insert(f.db, "cost_events", {
      organization_id: f.org.id,
      influencer_id: f.identity.id,
      amount: "0.032500",
      currency: "BRL",
      cost_type: `audience:${f.imported.execution_id}`,
    });
    assert.equal((await enrichAudienceReceipts(f.db)).enriched, 1);
    const latest = await one(
      f.db,
      "SELECT receipt FROM custom_dim.audience_execution_receipts WHERE execution_id=$1 ORDER BY sequence_no DESC LIMIT 1",
      [f.imported.execution_id],
    );
    assert.deepEqual(latest.receipt.cost, {
      amount: "0.032500",
      currency: "BRL",
    });
    assert.equal(latest.receipt.metrics, undefined);
    assert.equal((await enrichAudienceReceipts(f.db)).enriched, 0);
    await insert(f.db, "cost_events", {
      organization_id: f.org.id,
      influencer_id: f.identity.id,
      amount: "999999999000.000001",
      currency: "BRL",
      cost_type: `audience:${f.imported.execution_id}`,
    });
    await f.db.query(
      "UPDATE custom_dim.audience_execution_requests SET last_enriched_at=NULL WHERE id=$1",
      [f.imported.execution_id],
    );
    assert.equal((await enrichAudienceReceipts(f.db)).enriched, 1);
    const exact = await one(
      f.db,
      "SELECT receipt FROM custom_dim.audience_execution_receipts WHERE execution_id=$1 ORDER BY sequence_no DESC LIMIT 1",
      [f.imported.execution_id],
    );
    assert.equal(exact.receipt.cost.amount, "999999999000.032501");
    const execution = await one(
      f.db,
      "SELECT * FROM custom_dim.audience_execution_requests WHERE id=$1",
      [f.imported.execution_id],
    );
    await assert.rejects(() =>
      f.db.transaction((tx) =>
        executionReceipt(tx, execution, "succeeded", {
          cost: { amount: "-1", currency: "BRL" },
        }),
      ),
    );
    await assert.rejects(() =>
      f.db.transaction((tx) =>
        executionReceipt(tx, execution, "succeeded", {
          metrics: { views: -1 },
        }),
      ),
    );
  } finally {
    await f.db.close();
  }
});
