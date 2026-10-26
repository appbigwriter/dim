import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { channelMetrics } from "../packages/connectors/src/channels-metrics";
import { collectAdditionalMetrics } from "../packages/core/src/additional-metrics";
const channel = `UC${"a".repeat(22)}`;
test("YouTube metric counts preserve exact integers and reject a video owned by another channel", async () => {
  const transport = (owner: string): typeof fetch =>
    (async (url: any) =>
      String(url).includes("channels?")
        ? Response.json({ items: [{ id: channel }] })
        : Response.json({
            items: [
              {
                id: "video1",
                snippet: { channelId: owner },
                statistics: { viewCount: "9007199254740993", likeCount: "0" },
              },
            ],
          })) as typeof fetch;
  const metrics = await channelMetrics(
    "youtube",
    channel,
    "video1",
    { token: "private" },
    [],
    transport(channel),
  );
  assert.deepEqual(
    metrics.map((metric) => [metric.code, metric.value]),
    [
      ["views", "9007199254740993"],
      ["likes", "0"],
    ],
  );
  assert.equal(
    metrics.some((metric) => metric.code === "comments"),
    false,
  );
  await assert.rejects(
    () =>
      channelMetrics(
        "youtube",
        channel,
        "video1",
        { token: "private" },
        [],
        transport(`UC${"b".repeat(22)}`),
      ),
    /outro canal/,
  );
});
test("Meta metrics verify account/post ownership and never fill absent counters with zeros", async () => {
  const secret = {
    token: "page-token",
    graph_version: "v25.0",
    app_access_token: "app-token",
    page_id: "123",
  };
  const fetcher = (async (url: any) => {
    const raw = String(url);
    if (raw.includes("debug_token"))
      return Response.json({
        data: {
          is_valid: true,
          scopes: [
            "pages_manage_posts",
            "pages_read_engagement",
            "instagram_basic",
            "instagram_content_publish",
          ],
        },
      });
    if (raw.includes("/me?")) return Response.json({ id: "123" });
    if (raw.includes("instagram_business_account"))
      return Response.json({ instagram_business_account: { id: "456" } });
    if (raw.includes("/insights?"))
      return Response.json({
        data: [{ name: "reach", values: [{ value: 25 }] }],
      });
    if (raw.includes("/789?"))
      return Response.json({ id: "789", owner: { id: "456" }, like_count: 3 });
    return Response.json({
      id: "123_99",
      from: { id: "123" },
      comments: { summary: { total_count: 7 } },
    });
  }) as typeof fetch;
  assert.deepEqual(
    (
      await channelMetrics("facebook", "123", "123_99", secret, [], fetcher)
    ).map((metric) => metric.code),
    ["comments"],
  );
  assert.deepEqual(
    (
      await channelMetrics(
        "instagram",
        "456",
        "789",
        secret,
        ["instagram_manage_insights"],
        fetcher,
      )
    ).map((metric) => [metric.code, metric.value]),
    [
      ["likes", "3"],
      ["reach", "25"],
    ],
  );
  await assert.rejects(
    () => channelMetrics("telegram", "123", "1", secret, [], fetcher),
    /não disponibiliza/,
  );
});
test("CMS metrics use scoped Audience URL, verify exact destination receipt and require real metric values", async () => {
  const secret = {
    token: "private",
    metrics_url:
      "https://audience.example.org/metrics?tenant_id=tenant-a&project_id=project-a",
    allowed_origins: '["https://audience.example.org"]',
  };
  const fetcher = (async (url: any) => {
    const request = new URL(url);
    assert.equal(request.searchParams.get("tenant_id"), "tenant-a");
    assert.equal(request.searchParams.get("destination"), "blog-a");
    assert.equal(request.searchParams.get("external_id"), "post-a");
    return Response.json({
      contractId: "dim.channel-metrics.v1",
      provider: "cms",
      owner: "audience-builder",
      destination: "blog-a",
      externalId: "post-a",
      metrics: [{ code: "approved_comments", value: "4" }],
    });
  }) as typeof fetch;
  assert.equal(
    (await channelMetrics("cms", "blog-a", "post-a", secret, [], fetcher))[0]
      .value,
    "4",
  );
  await assert.rejects(() =>
    channelMetrics(
      "cms",
      "blog-a",
      "post-a",
      { ...secret, metrics_url: "https://127.0.0.1/internal" },
      [],
      fetcher,
    ),
  );
});
test("additional collector appends exact observations and ignores credential revoked during provider readback", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: "METRICS",
      slug: "metrics",
      public_name: "Metrics",
      internal_name: "Metrics",
      type: "virtual",
    });
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='youtube'",
    );
    const connector = await one(
      f.db,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
      [platform.id],
    );
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "profile",
      external_id: channel,
      account_status: "active",
      integration_status: "connected",
    });
    const integration = await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "oauth2",
      status: "active",
      secret_ref: `dim/${f.org.id}/${account.id}/token`,
    });
    const content = await insert(f.db, "content_items", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      title: "Metric fixture",
      content_type: "text",
    });
    const version = await insert(f.db, "content_versions", {
      organization_id: f.org.id,
      content_id: content.id,
      version_number: 1,
      language: "pt-BR",
      format: "text",
      payload_hash: "fixture-hash",
    });
    const approval = await insert(f.db, "content_approvals", {
      organization_id: f.org.id,
      content_version_id: version.id,
      approver_id: f.reviewer,
      decision: "approved",
      payload_hash: "fixture-hash",
      policy_version: 1,
    });
    const job = await insert(f.db, "publication_jobs", {
      organization_id: f.org.id,
      social_account_id: account.id,
      content_version_id: version.id,
      approval_id: approval.id,
      scheduled_at: new Date().toISOString(),
      idempotency_key: "metric-fixture",
      requested_by: f.editor,
      status: "published",
    });
    const post = await insert(f.db, "published_posts", {
      organization_id: f.org.id,
      job_id: job.id,
      external_post_id: "video1",
      state: "published",
    });
    const vault = { get: async () => ({ token: "test" }), put: async () => {} };
    let revoke = false;
    const fetcher = (async (url: any) => {
      if (String(url).includes("channels?"))
        return Response.json({ items: [{ id: channel }] });
      if (revoke)
        await f.db.query(
          "UPDATE custom_dim.account_integrations SET status='revoked' WHERE id=$1",
          [integration.id],
        );
      return Response.json({
        items: [
          {
            id: "video1",
            snippet: { channelId: channel },
            statistics: { viewCount: "9007199254740993" },
          },
        ],
      });
    }) as typeof fetch;
    await collectAdditionalMetrics(f.db, vault, fetcher);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT metric_value::text AS value FROM custom_dim.publication_metrics",
        )
      ).value,
      "9007199254740993",
    );
    await f.db.query(
      "UPDATE custom_dim.published_posts SET metrics_attempted_at=NULL WHERE id=$1",
      [post.id],
    );
    revoke = true;
    await collectAdditionalMetrics(f.db, vault, fetcher);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM custom_dim.publication_metrics",
        )
      ).n,
      1,
    );
  } finally {
    await f.db.close();
  }
});
