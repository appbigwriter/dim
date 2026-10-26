import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { executeAutomation } from "../packages/core/src/automation";
import { scoped } from "../packages/core/src/security";
import { contentVersion } from "../packages/core/src/editorial";
test("bounded workflows execute real checklist, review queue, metrics, campaign, security and offboarding; replay and cross-tenant denied", async () => {
  const f = await fixture(),
    vault = { get: async () => ({ token: "unused" }), put: async () => {} };
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      public_name: "Workflow",
      internal_name: "Workflow",
      code: "workflow",
      slug: "workflow",
      type: "human",
      owner_user_id: f.admin,
    });
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "bot",
      external_id: "123",
    });
    const content = await insert(f.db, "content_items", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      title: "Review",
      content_type: "text",
    });
    await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, {
        body_text: "Texto para revisão",
        body: {},
        asset_ids: [],
        source_urls: ["https://example.org"],
        language: "pt-BR",
        format: "text",
      }),
    );
    const campaign = await insert(f.db, "campaigns", {
      organization_id: f.org.id,
      name: "Test campaign",
    });
    let onboard: any;
    for (const [kind, subject] of [
      ["identity.onboard", identity.id],
      ["identity.audit", identity.id],
      ["content.approve", content.id],
      ["social.metrics", account.id],
      ["campaign.track", campaign.id],
      ["security.monitor", f.org.id],
      ["identity.offboard", identity.id],
    ]) {
      const job = await insert(f.db, "operation_jobs", {
        organization_id: f.org.id,
        job_type: kind,
        subject_id: subject,
        status: "running",
        payload: { requested_by: f.admin, requested_aal: "aal2" },
      });
      const result = await executeAutomation(f.db, job.id, vault);
      assert.equal(result.completed, true, kind);
      assert.deepEqual(await executeAutomation(f.db, job.id, vault), result);
      if (kind === "identity.onboard") {
        onboard = result;
        assert(result.tasks.length >= 6);
        assert(result.account_tasks.length >= 4);
      }
      if (kind === "content.approve") {
        assert.equal(result.approved, false);
        assert.equal(
          (
            await one(
              f.db,
              "SELECT count(*)::int AS n FROM custom_dim.content_approvals",
            )
          ).n,
          0,
        );
      }
      if (kind === "identity.offboard") {
        assert.equal(result.local_access_revoked, true);
        assert.equal(result.official_revocation_confirmed, false);
      }
    }
    assert(onboard.session_id);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT integration_status FROM custom_dim.social_accounts WHERE id=$1",
          [account.id],
        )
      ).integration_status,
      "revoked",
    );
    const foreign = await insert(f.db, "operation_jobs", {
      organization_id: f.other.id,
      job_type: "identity.audit",
      subject_id: identity.id,
      status: "running",
      payload: { requested_by: f.admin, requested_aal: "aal2" },
    });
    await assert.rejects(
      () => executeAutomation(f.db, foreign.id, vault),
      /encontrado/,
    );
  } finally {
    await f.db.close();
  }
});
