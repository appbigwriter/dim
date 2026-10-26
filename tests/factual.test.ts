import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import { contentVersion } from "../packages/core/src/editorial";
import {
  configureRiskPolicy,
  reviewFacts,
  factualFlags,
} from "../packages/core/src/factual";
import {
  publicAddress,
  validateSourceUrl,
} from "../packages/connectors/src/sources";

test("source fetch rejects private DNS, unapproved origins and mixed public/private answers", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ])
    assert.equal(publicAddress(ip), false);
  const resolver: any = async () => [{ address: "127.0.0.1", family: 4 }];
  await assert.rejects(
    () =>
      validateSourceUrl("https://example.org/facts", ["example.org"], resolver),
    /não pública/,
  );
  await assert.rejects(
    () =>
      validateSourceUrl(
        "https://example.org.evil.test/facts",
        ["example.org"],
        resolver,
      ),
    /domínios/,
  );
  await assert.rejects(
    () => validateSourceUrl("https://127.0.0.1/facts", ["127.0.0.1"], resolver),
    /domínios/,
  );
  await assert.rejects(
    () =>
      validateSourceUrl(
        "https://example.org/facts",
        ["example.org"],
        (async () => [
          { address: "8.8.8.8", family: 4 },
          { address: "10.0.0.1", family: 4 },
        ]) as any,
      ),
    /não pública/,
  );
});

test("factual review binds source quote, independent reviewer, exact content and policy; immutable and tenant isolated", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      public_name: "Facts",
      internal_name: "Facts",
      code: "facts",
      slug: "facts",
      type: "human",
      owner_user_id: f.admin,
    });
    const content = await insert(f.db, "content_items", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      title: "Facts",
      content_type: "text",
    });
    const version = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, {
        body_text: "A pesquisa observou 42 respostas.",
        language: "pt-BR",
        format: "text",
        body: {},
        asset_ids: [],
        source_urls: ["https://example.org/study"],
      }),
    );
    const policy = {
      allowedSourceDomains: ["example.org"],
      blockedTerms: ["garantia absoluta"],
      requiredPhrases: [],
      requireSourceEvidence: true,
      requireFactualReview: true,
      maxEvidenceAgeHours: 168,
      requiredApprovals: 1,
    };
    await f.db.transaction((tx) => configureRiskPolicy(tx, f.actor, policy));
    assert.deepEqual(
      await scoped(f.db, f.reviewActor, (tx) =>
        factualFlags(tx, f.reviewActor, version, identity),
      ),
      ["factual_review_required"],
    );
    const input = {
      claims: [
        {
          claim: "42 respostas",
          sourceUrl: "https://example.org/study",
          quote: "42 respostas",
          decision: "supported",
          reason: "Trecho do resultado conferido",
        },
      ],
    };
    const reader = async () => ({
      url: "https://example.org/study",
      text: "O relatório contém 42 respostas.",
      sha256: "a".repeat(64),
      observed_at: new Date().toISOString(),
    });
    await assert.rejects(() =>
      reviewFacts(f.db, f.editActor, version.id, input, reader),
    );
    const failed = await reviewFacts(
      f.db,
      f.reviewActor,
      version.id,
      { claims: [{ ...input.claims[0], quote: "Citação inventada" }] },
      reader,
    );
    assert.equal(failed.passed, false);
    const good = await reviewFacts(
      f.db,
      f.reviewActor,
      version.id,
      input,
      reader,
    );
    assert.equal(good.passed, true);
    assert.deepEqual(
      await scoped(f.db, f.reviewActor, (tx) =>
        factualFlags(tx, f.reviewActor, version, identity),
      ),
      [],
    );
    await assert.rejects(
      () =>
        f.db.query(
          "UPDATE custom_dim.content_verifications SET passed=false WHERE id=$1",
          [good.id],
        ),
      /immutable|append|imut|mutation/i,
    );
    const foreign = { ...f.reviewActor, organizationId: f.other.id };
    await assert.rejects(() =>
      reviewFacts(f.db, foreign, version.id, input, reader),
    );
    await f.db.transaction((tx) =>
      configureRiskPolicy(tx, f.actor, { ...policy, requiredApprovals: 2 }),
    );
    assert.deepEqual(
      await scoped(f.db, f.reviewActor, (tx) =>
        factualFlags(tx, f.reviewActor, version, identity),
      ),
      ["factual_review_required"],
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM custom_dim.content_verifications",
        )
      ).n,
      2,
    );
  } finally {
    await f.db.close();
  }
});
