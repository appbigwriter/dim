import { collectMetrics } from "../packages/core/src/monitoring";
import { analytics } from "../packages/core/src/queries";
import { reschedule } from "../packages/core/src/completion";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped, hash } from "../packages/core/src/security";
import { createResource } from "../packages/core/src/resources";
import { transition, persona } from "../packages/core/src/identity";
import {
  contentVersion,
  approve,
  schedule,
} from "../packages/core/src/editorial";
import { executePublication } from "../apps/worker/src/publication";
import {
  ProviderFailure,
  type Connector,
  type Vault,
} from "../packages/connectors/src/index";
import { loadActor } from "../packages/core/src/access";
import { list } from "../packages/core/src/queries";
const vault: Vault = {
  get: async () => ({ token: "server-only" }),
  put: async () => {},
};
export async function operational(
  f: Awaited<ReturnType<typeof fixture>>,
  type = "virtual",
) {
  const { db, org, admin, editor, actor, reviewActor } = f;
  const identity = await scoped(db, actor, (tx) =>
    createResource(tx, actor, "influencers", {
      public_name: `Identity ${type}`,
      internal_name: "Internal",
      slug: `id-${randomUUID()}`,
      type,
      owner_user_id: admin,
    }),
  );
  // Legacy fixtures isolate social transport/governance tests from Audience's separate contract suite.
  await db.query(
    "UPDATE custom_dim.influencers SET persona_source='legacy_local' WHERE id=$1",
    [identity.id],
  );
  const object = await insert(db, "storage_objects", {
    organization_id: org.id,
    bucket: "dim-private",
    object_path: `${org.id}/${randomUUID()}`,
    visibility: "private",
  });
  const party = await insert(db, "legal_parties", {
    organization_id: org.id,
    party_type: "person",
    display_name: "Titular",
  });
  if (type !== "virtual") {
    await insert(db, "influencer_contracts", {
      organization_id: org.id,
      influencer_id: identity.id,
      owner_party_id: party.id,
      contract_type: "representation",
      starts_at: "2020-01-01T00:00:00Z",
      ends_at: "2099-01-01T00:00:00Z",
      storage_object_id: object.id,
      status: "signed",
    });
    for (const use of type === "hybrid"
      ? ["image", "voice", "synthetic_image", "synthetic_voice"]
      : ["image", "voice"])
      await insert(db, "identity_consents", {
        organization_id: org.id,
        influencer_id: identity.id,
        subject_party_id: party.id,
        use_type: use,
        evidence_object_id: object.id,
        granted_at: "2020-01-01T00:00:00Z",
      });
  }
  if (type !== "human") {
    await scoped(db, actor, (tx) =>
      persona(tx, actor, identity.id, {
        public_bio: "Persona",
        tone: {},
        traits: {},
        knowledge: {},
        boundaries: {},
        approval_status: "approved",
      }),
    );
    const platform = await one(
      db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    await insert(db, "identity_disclosures", {
      organization_id: org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      disclosure_type: "synthetic",
      disclosure_text: "Personagem virtual",
    });
  }
  const platform = await one(
    db,
    "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
  );
  const connector = await one(
    db,
    "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
    [platform.id],
  );
  const account = await insert(db, "social_accounts", {
    organization_id: org.id,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "channel",
    external_id: `-${Date.now()}-${randomUUID()}`,
    account_status: "active",
    integration_status: "connected",
  });
  await insert(db, "account_integrations", {
    organization_id: org.id,
    social_account_id: account.id,
    connector_id: connector.id,
    auth_type: "test",
    secret_ref: "test-only-reference",
    status: "active",
    last_tested_at: new Date().toISOString(),
  });
  await insert(db, "account_capabilities", {
    organization_id: org.id,
    social_account_id: account.id,
    capability_code: "publish_text",
    available: true,
    checked_at: new Date().toISOString(),
  });
  await insert(db, "influencer_assignments", {
    organization_id: org.id,
    influencer_id: identity.id,
    user_id: editor,
    responsibility: "editor",
  });
  if (
    !(await one(
      db,
      "SELECT id FROM custom_dim.approval_policies WHERE organization_id=$1",
      [org.id],
    ))
  )
    await insert(db, "approval_policies", {
      organization_id: org.id,
      code: "editorial",
      resource_type: "content",
      version: 1,
    });
  const session = await one(
    db,
    "SELECT id FROM custom_dim.onboarding_sessions WHERE influencer_id=$1",
    [identity.id],
  );
  await insert(db, "onboarding_approvals", {
    organization_id: org.id,
    session_id: session.id,
    approval_type: "identity",
    reviewer_id: reviewActor.userId,
    decision: "approved",
  });
  await db.query(
    "UPDATE custom_dim.onboarding_steps SET status='completed' WHERE session_id=$1 AND step_code<>'activation'",
    [session.id],
  );
  for (const status of [
    "under_review",
    "approved",
    "provisioning",
    "ready",
    "active",
  ]) {
    const current = await one(
      db,
      "SELECT row_version FROM custom_dim.influencers WHERE id=$1",
      [identity.id],
    );
    await scoped(db, actor, (tx) =>
      transition(tx, actor, identity.id, {
        status,
        reason: "Tested onboarding",
        row_version: current.row_version,
      }),
    );
  }
  return { identity, account };
}
test("human, virtual and hybrid complete guarded onboarding; empty rights cannot approve", async () => {
  const f = await fixture();
  try {
    for (const type of ["human", "virtual", "hybrid"]) {
      const { identity } = await operational(f, type);
      assert.equal(
        (
          await one(
            f.db,
            "SELECT status FROM custom_dim.influencers WHERE id=$1",
            [identity.id],
          )
        ).status,
        "active",
      );
    }
    const draft = await scoped(f.db, f.actor, (tx) =>
      createResource(tx, f.actor, "influencers", {
        public_name: "Missing rights",
        internal_name: "X",
        slug: "missing",
        type: "human",
        owner_user_id: f.admin,
      }),
    );
    await scoped(f.db, f.actor, (tx) =>
      transition(tx, f.actor, draft.id, {
        status: "under_review",
        reason: "Submit",
        row_version: 1,
      }),
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          transition(tx, f.actor, draft.id, {
            status: "approved",
            reason: "Approve",
            row_version: 2,
          }),
        ),
      /signed_contract/,
    );
  } finally {
    await f.db.close();
  }
});
test("approved exact hash -> idempotent publication -> external ID, no duplicated delivery", async () => {
  const f = await fixture();
  try {
    const { identity, account } = await operational(f);
    const content = await scoped(f.db, f.editActor, (tx) =>
      createResource(tx, f.editActor, "contents", {
        influencer_id: identity.id,
        title: "Editorial",
        content_type: "text",
        objective: "Informar",
      }),
    );
    const version = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, {
        body_text: "Personagem virtual. Artigo com fontes.",
        language: "pt-BR",
        format: "text",
        source_urls: ["https://example.org/source"],
      }),
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          approve(tx, { ...f.actor, userId: f.editor }, content.id, {
            content_version_id: version.id,
            decision: "approved",
            rationale: "Self",
          }),
        ),
      /Outro revisor/,
    );
    const approval = await scoped(f.db, f.reviewActor, (tx) =>
      approve(tx, f.reviewActor, content.id, {
        content_version_id: version.id,
        decision: "approved",
        rationale: "Fontes e disclosure conferidos",
      }),
    );
    assert.equal(approval.payload_hash, version.payload_hash);
    const input = {
      social_account_id: account.id,
      content_version_id: version.id,
      scheduled_at: new Date().toISOString(),
    };
    const key = randomUUID();
    await f.db.query(
      "UPDATE custom_dim.approval_policies SET conditions='{\"required_approvals\":2}' WHERE organization_id=$1",
      [f.org.id],
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          schedule(tx, f.editActor, input, randomUUID()),
        ),
      /mais aprovações/,
    );
    await f.db.query(
      "UPDATE custom_dim.approval_policies SET conditions='{\"required_approvals\":1}' WHERE organization_id=$1",
      [f.org.id],
    );
    const job = await scoped(f.db, f.editActor, (tx) =>
      schedule(tx, f.editActor, input, key),
    );
    const repeated = await scoped(f.db, f.editActor, (tx) =>
      schedule(tx, f.editActor, input, key),
    );
    assert.equal(job.id, repeated.id);
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          schedule(
            tx,
            f.editActor,
            { ...input, scheduled_at: "2090-01-01T00:00:00Z" },
            key,
          ),
        ),
      /Payload|Chave/,
    );
    let calls = 0;
    const connector: Connector = {
      publish: async () => {
        calls++;
        return { externalId: "1234567890" };
      },
      health: async () => ({
        publish: true,
        readMessages: true,
        sendMessages: true,
      }),
    };
    const future = new Date(Date.now() + 3600000).toISOString();
    const moved = await scoped(f.db, f.editActor, (tx) =>
      reschedule(tx, f.editActor, job.id, {
        scheduled_at: future,
        row_version: job.row_version,
      }),
    );
    assert.equal(moved.row_version, 2);
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          reschedule(tx, f.editActor, job.id, {
            scheduled_at: future,
            row_version: job.row_version,
          }),
        ),
      /alterado/,
    );
    assert.equal(
      new Date(
        (
          await one(
            f.db,
            "SELECT planned_at FROM custom_dim.editorial_calendar_items WHERE publication_job_id=$1",
            [job.id],
          )
        ).planned_at,
      ).toISOString(),
      future,
    );
    await executePublication(f.db, job.id, connector, vault);
    assert.equal(calls, 0);
    await f.db.query(
      "UPDATE custom_dim.publication_jobs SET scheduled_at=now()-interval '1 second' WHERE id=$1",
      [job.id],
    );
    await executePublication(f.db, job.id, connector, vault);
    await executePublication(f.db, job.id, connector, vault);
    assert.equal(calls, 1);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT external_post_id FROM custom_dim.published_posts WHERE job_id=$1",
          [job.id],
        )
      ).external_post_id,
      "1234567890",
    );
    const xPlatform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='x'",
    );
    await f.db.query(
      "UPDATE custom_dim.social_accounts SET platform_id=$1,external_id=$2 WHERE id=$3",
      [xPlatform.id, "456", account.id],
    );
    await f.db.query(
      "UPDATE custom_dim.account_integrations SET secret_ref=$1 WHERE social_account_id=$2",
      [`dim/${f.org.id}/${account.id}/token`, account.id],
    );
    await collectMetrics(f.db, vault, (async () =>
      Response.json({
        data: {
          id: "1234567890",
          author_id: "456",
          public_metrics: { like_count: 12, impression_count: 100 },
        },
      })) as typeof fetch);
    const metrics = await analytics(f.db, f.actor, {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: new Date(Date.now() + 1000).toISOString(),
    });
    assert.equal(
      metrics.metrics.find((m) => m.metric_code === "like_count").delta,
      "12",
    );
    const published = await one(
      f.db,
      "SELECT * FROM custom_dim.published_posts WHERE job_id=$1",
      [job.id],
    );
    await f.db.query(
      "UPDATE custom_dim.published_posts SET metrics_attempted_at=NULL WHERE id=$1",
      [published.id],
    );
    await collectMetrics(
      f.db,
      vault,
      (async () =>
        new Response("Unavailable", { status: 503 })) as typeof fetch,
    );
    assert.equal(
      (
        await f.db.query(
          "SELECT * FROM custom_dim.publication_metrics WHERE published_post_id=$1",
          [published.id],
        )
      ).rows.length,
      2,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT metrics_status FROM custom_dim.published_posts WHERE id=$1",
          [published.id],
        )
      ).metrics_status,
      "unavailable",
    );
    await f.db.query(
      "UPDATE custom_dim.social_accounts SET platform_id=$1,external_id=$2 WHERE id=$3",
      [account.platform_id, account.external_id, account.id],
    );
    const next = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, {
        body_text: "Personagem virtual. Mudança.",
        language: "pt-BR",
        format: "text",
        source_urls: ["https://example.org/source"],
      }),
    );
    assert.notEqual(next.payload_hash, version.payload_hash);
    await assert.rejects(
      () =>
        scoped(f.db, f.editActor, (tx) =>
          schedule(tx, f.editActor, input, randomUUID()),
        ),
      /Conteúdo foi modificado/,
    );
  } finally {
    await f.db.close();
  }
});
test("uncertain external result never automatically re-sends; revoked membership blocks worker", async () => {
  const f = await fixture();
  try {
    const { identity, account } = await operational(f);
    const content = await scoped(f.db, f.editActor, (tx) =>
      createResource(tx, f.editActor, "contents", {
        influencer_id: identity.id,
        title: "Test",
        content_type: "text",
        objective: "Test",
      }),
    );
    const version = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, {
        body_text: "Personagem virtual. Teste",
        language: "pt-BR",
        format: "text",
        source_urls: ["https://example.org"],
      }),
    );
    await scoped(f.db, f.reviewActor, (tx) =>
      approve(tx, f.reviewActor, content.id, {
        content_version_id: version.id,
        decision: "approved",
        rationale: "OK",
      }),
    );
    const input = {
      social_account_id: account.id,
      content_version_id: version.id,
      scheduled_at: new Date().toISOString(),
    };
    const job = await scoped(f.db, f.editActor, (tx) =>
      schedule(tx, f.editActor, input, randomUUID()),
    );
    let calls = 0;
    const connector: Connector = {
      publish: async () => {
        calls++;
        throw new ProviderFailure("uncertain", "TIMEOUT");
      },
      health: async () => ({
        publish: true,
        readMessages: true,
        sendMessages: true,
      }),
    };
    await executePublication(f.db, job.id, connector, vault);
    await executePublication(f.db, job.id, connector, vault);
    assert.equal(calls, 1);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.publication_jobs WHERE id=$1",
          [job.id],
        )
      ).status,
      "uncertain",
    );
    const retryJob = await scoped(f.db, f.editActor, (tx) =>
      schedule(tx, f.editActor, input, randomUUID()),
    );
    let retries = 0;
    const rateConnector: Connector = {
      health: connector.health,
      publish: async () => {
        retries++;
        if (retries === 1) throw new ProviderFailure("retry", "RATE_LIMIT", 30);
        return { externalId: "rate-retry-success" };
      },
    };
    await assert.rejects(
      () => executePublication(f.db, retryJob.id, rateConnector, vault),
      /RATE_LIMIT/,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.publication_jobs WHERE id=$1",
          [retryJob.id],
        )
      ).status,
      "retry",
    );
    await executePublication(f.db, retryJob.id, rateConnector, vault);
    await executePublication(f.db, retryJob.id, rateConnector, vault);
    assert.equal(retries, 2);
    const next = await scoped(f.db, f.editActor, (tx) =>
      schedule(tx, f.editActor, input, randomUUID()),
    );
    await f.db.query(
      "UPDATE custom_dim.organization_members SET status='revoked' WHERE user_id=$1 AND organization_id=$2",
      [f.editor, f.org.id],
    );
    await executePublication(f.db, next.id, connector, vault);
    assert.equal(calls, 1);
  } finally {
    await f.db.close();
  }
});
test("scope filters before pagination and changed memberships deny access", async () => {
  const f = await fixture();
  try {
    const a = await operational(f);
    const b = await operational(f, "human");
    await f.db.query(
      "DELETE FROM custom_dim.role_assignments WHERE user_id=$1",
      [f.editor],
    );
    const role = await one(
      f.db,
      "SELECT id FROM custom_dim.roles WHERE organization_id=$1 AND code='editor'",
      [f.org.id],
    );
    await insert(f.db, "role_assignments", {
      organization_id: f.org.id,
      user_id: f.editor,
      role_id: role.id,
      scope_type: "influencer",
      scope_id: a.identity.id,
    });
    const actor = await loadActor(
      f.db,
      f.editor,
      f.org.id,
      "aal1",
      randomUUID(),
    );
    const result = await scoped(f.db, actor, (tx) =>
      list(tx, actor, "influencers", { per_page: 1 }),
    );
    assert.equal(result.total, 1);
    assert.equal(result.data[0].id, a.identity.id);
    assert.notEqual(result.data[0].id, b.identity.id);
    await assert.rejects(
      () => loadActor(f.db, f.editor, f.other.id, "aal1", randomUUID()),
      /Organização indisponível/,
    );
    assert.equal(hash({ a: 1 }), hash({ a: 1 }));
  } finally {
    await f.db.close();
  }
});
