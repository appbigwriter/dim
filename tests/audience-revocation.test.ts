import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { audienceFixture } from "./audience-fixture";
import {
  audienceActionHash,
  validateAudienceAction,
  type AudienceAction,
} from "../packages/contracts/src/audience-actions";
import type { AudienceActions } from "../packages/connectors/src/audience-actions";
import { FacebookConnector } from "../packages/connectors/src/channels";
import { bindAudience, syncAudience } from "../packages/core/src/audience";
import {
  configureAudienceExecutor,
  importAudienceAction,
  pollAudienceActions,
  scheduleAudienceExecution,
} from "../packages/core/src/audience-execution";
import { createResource } from "../packages/core/src/resources";
import { scoped } from "../packages/core/src/security";
import { approve } from "../packages/core/src/editorial";
import { assignRole } from "../packages/db/src/seed";
import { insert, one, type DB, type Database } from "../packages/db/src/index";
import { executePublication } from "../apps/worker/src/publication";

const binding = {
  tenant_id: "audience-tenant-a",
  project_id: "audience-project-a",
  persona_id: "persona-a",
};
function approvedAction(accountId: string): AudienceAction {
  const action: AudienceAction = {
    contractId: "dim.audience-action.v1",
    actionId: "revocation-action",
    tenantId: binding.tenant_id,
    projectId: binding.project_id,
    personaId: binding.persona_id,
    contextVersion: 1,
    contextHash: audienceFixture().contextHash,
    kind: "publication",
    channel: "telegram",
    targetAccountId: accountId,
    scheduledAt: new Date().toISOString(),
    content: {
      text: "Persona virtual. Conteúdo conferido.",
      title: "Approved",
      mediaAssetIds: [],
      sourceUrls: ["https://source.example.org/proof"],
      language: "pt-BR",
    },
    approval: {
      approvalId: "source-approval",
      approvedBy: "independent-source-reviewer",
      approvedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    idempotencyKey: "revocation-action-key",
    actionHash: "",
  };
  action.actionHash = audienceActionHash(action);
  return action;
}
async function setup() {
  const f = await fixture();
  try {
    const identity = await scoped(f.db, f.actor, (tx) =>
      createResource(tx, f.actor, "influencers", {
        public_name: "Revocation",
        internal_name: "Revocation",
        slug: `revocation-${randomUUID()}`,
        type: "virtual",
        owner_user_id: f.admin,
      }),
    );
    await scoped(f.db, f.actor, (tx) =>
      bindAudience(tx, f.actor, identity.id, binding),
    );
    await syncAudience(f.db, f.actor, identity.id, async () =>
      audienceFixture(),
    );
    await f.db.query(
      "UPDATE custom_dim.influencers SET status='active' WHERE id=$1",
      [identity.id],
    );
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    const connector = await one(
      f.db,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
      [platform.id],
    );
    await insert(f.db, "identity_disclosures", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      disclosure_type: "synthetic",
      disclosure_text: "Persona virtual",
    });
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "channel",
      account_status: "active",
      integration_status: "connected",
      external_id: "-123",
    });
    await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "bot_token",
      status: "active",
      secret_ref: `dim/${f.org.id}/${account.id}/token`,
      last_tested_at: new Date().toISOString(),
    });
    await insert(f.db, "account_capabilities", {
      organization_id: f.org.id,
      social_account_id: account.id,
      capability_code: "publish_text",
      available: true,
      checked_at: new Date().toISOString(),
    });
    await insert(f.db, "approval_policies", {
      organization_id: f.org.id,
      code: "editorial",
      version: 1,
      resource_type: "content",
    });
    const action = approvedAction(account.id);
    const source: AudienceActions = {
      list: async () => [action],
      get: async () => action,
      receipt: async () => {},
    };
    await assignRole(f.db, f.org.id, f.editor, "audience_executor");
    await configureAudienceExecutor(f.db, f.actor, identity.id, true, f.editor);
    const prepare = async () => {
      const execution = await importAudienceAction(
        f.db,
        f.editActor,
        identity.id,
        action.actionId,
        source,
        true,
      );
      await scoped(f.db, f.reviewActor, (tx) =>
        approve(tx, f.reviewActor, execution.content_id, {
          content_version_id: execution.content_version_id,
          decision: "approved",
          rationale: "Independent review",
        }),
      );
      return execution;
    };
    return { ...f, identity, account, action, source, prepare };
  } catch (error) {
    await f.db.close();
    throw error;
  }
}
test("source readback that observes membership revocation blocks publication before provider mutation", async () => {
  const f = await setup();
  try {
    const execution = await f.prepare();
    const job = await scoped(f.db, f.editActor, (tx) =>
      scheduleAudienceExecution(tx, f.editActor, execution.execution_id),
    );
    let transaction: DB | undefined;
    // PGlite serializes connections; mutate through the active transaction to model the revocation visible to final authorization.
    const db: Database = {
      ...f.db,
      transaction: (fn) =>
        f.db.transaction(async (tx) => {
          transaction = tx;
          return fn(tx);
        }),
    };
    let sent = 0;
    const result = await executePublication(
      db,
      job.id,
      {
        health: async () => ({
          publish: true,
          readMessages: false,
          sendMessages: false,
        }),
        publish: async () => {
          sent++;
          return { externalId: "forbidden" };
        },
      },
      { get: async () => ({ token: "test" }), put: async () => {} },
      undefined,
      {
        ...f.source,
        get: async () => {
          // Only the test owner can emulate a concurrent control-plane revocation on this single PGlite connection.
          await transaction!.query("SET LOCAL ROLE NONE");
          await transaction!.query(
            "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
            [f.org.id, f.editor],
          );
          await transaction!.query("SET LOCAL ROLE dim_app");
          return f.action;
        },
      },
    );
    assert.equal(sent, 0);
    assert.equal((result as any).status, "blocked");
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.publication_jobs WHERE id=$1",
          [job.id],
        )
      ).status,
      "blocked",
    );
  } finally {
    await f.db.close();
  }
});
test("Facebook health completed before permission revocation cannot bypass final beforeSend guard", async () => {
  let healthRequests = 0,
    mutations = 0,
    revoked = false;
  const connector = new FacebookConnector(
    { graph_version: "v25.0", app_access_token: "app-token" },
    (async (url: any, init?: RequestInit) => {
      if (init?.method === "POST") {
        mutations++;
        return Response.json({ id: "123_456" });
      }
      healthRequests++;
      if (String(url).includes("debug_token"))
        return Response.json({
          data: {
            is_valid: true,
            scopes: ["pages_manage_posts", "pages_read_engagement"],
          },
        });
      revoked = true;
      return Response.json({ id: "123" });
    }) as typeof fetch,
  );
  await assert.rejects(
    () =>
      connector.publish({
        token: "page-token",
        destination: "123",
        text: "Approved content",
        idempotencyKey: "permission-test",
        beforeSend: async () => {
          assert.equal(revoked, true);
          throw new Error("PERMISSION_REVOKED");
        },
      }),
    /PERMISSION_REVOKED/,
  );
  assert.equal(healthRequests, 2);
  assert.equal(mutations, 0);
});
test("disabling the Audience executor during list or action readback prevents automatic import", async () => {
  for (const stage of ["list", "get"] as const) {
    const f = await setup();
    try {
      const disable = () =>
        f.db.query(
          "UPDATE custom_dim.audience_bindings SET execution_enabled=false WHERE influencer_id=$1",
          [f.identity.id],
        );
      const source: AudienceActions = {
        ...f.source,
        list: async () => {
          if (stage === "list") await disable();
          return [f.action];
        },
        get: async () => {
          if (stage === "get") await disable();
          return f.action;
        },
      };
      const result = await pollAudienceActions(f.db, source, async () =>
        audienceFixture(),
      );
      assert.equal(result.imported, 0, stage);
      assert.equal(result.scheduled, 0, stage);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT count(*)::int AS n FROM custom_dim.audience_execution_requests",
          )
        ).n,
        0,
      );
    } finally {
      await f.db.close();
    }
  }
});
test("disabling executor during list prevents scheduling an already reviewed automatic action", async () => {
  const f = await setup();
  try {
    await f.prepare();
    const result = await pollAudienceActions(
      f.db,
      {
        ...f.source,
        list: async () => {
          await f.db.query(
            "UPDATE custom_dim.audience_bindings SET execution_enabled=false WHERE influencer_id=$1",
            [f.identity.id],
          );
          return [];
        },
      },
      async () => audienceFixture(),
    );
    assert.equal(result.scheduled, 0);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM custom_dim.publication_jobs",
        )
      ).n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("automatic executor promoted to admin cannot inherit MFA assurance from worker", async () => {
  const f = await setup();
  try {
    const execution = await f.prepare();
    const job = await scoped(f.db, f.editActor, (tx) =>
      scheduleAudienceExecution(tx, f.editActor, execution.execution_id),
    );
    assert.equal(job.requested_aal, "aal1");
    await assignRole(f.db, f.org.id, f.editor, "admin");
    let sent = 0;
    await executePublication(
      f.db,
      job.id,
      {
        health: async () => ({
          publish: true,
          readMessages: false,
          sendMessages: false,
        }),
        publish: async () => {
          sent++;
          return { externalId: "forbidden" };
        },
      },
      { get: async () => ({ token: "test" }), put: async () => {} },
      undefined,
      f.source,
    );
    assert.equal(sent, 0);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.publication_jobs WHERE id=$1",
          [job.id],
        )
      ).status,
      "blocked",
    );
  } finally {
    await f.db.close();
  }
});
test("YouTube source approval requires explicit audience/privacy declaration and binds it to the action hash", () => {
  const base = approvedAction(randomUUID());
  const video = {
    ...base,
    channel: "youtube" as const,
    content: {
      ...base.content,
      video: { madeForKids: false, privacyStatus: "private" as const },
    },
  };
  video.actionHash = audienceActionHash(video);
  assert.equal(
    validateAudienceAction(video, binding).content.video?.madeForKids,
    false,
  );
  const missing = { ...video, content: { ...base.content } };
  missing.actionHash = audienceActionHash(missing);
  assert.throws(() => validateAudienceAction(missing, binding), /declaração/);
  assert.throws(
    () =>
      validateAudienceAction(
        {
          ...video,
          content: {
            ...video.content,
            video: { ...video.content.video, privacyStatus: "public" },
          },
        },
        binding,
      ),
    /Hash/,
  );
  assert.throws(() =>
    validateAudienceAction(
      {
        ...video,
        content: { ...video.content, video: { privacyStatus: "private" } },
      },
      binding,
    ),
  );
});
