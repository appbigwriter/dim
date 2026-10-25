import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import {
  monitorAccounts,
  collectMetrics,
} from "../packages/core/src/monitoring";
import { analytics } from "../packages/core/src/queries";
test("health monitor disables failed capabilities, records history and never revives a concurrently revoked integration", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: "HEALTH",
      slug: "health",
      public_name: "Health",
      internal_name: "Health",
      type: "virtual",
    });
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='x'",
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
      account_status: "active",
      external_id: "123",
      integration_status: "connected",
    });
    const integration = await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "oauth2",
      status: "active",
      secret_ref: `dim/${f.org.id}/${account.id}/token`,
      granted_scopes: ["tweet.read", "tweet.write"],
    });
    const vault = { get: async () => ({ token: "test" }), put: async () => {} };
    await monitorAccounts(f.db, vault, async () => ({
      publish: false,
      readMessages: false,
      sendMessages: false,
    }));
    assert.equal(
      (
        await one(
          f.db,
          "SELECT available FROM custom_dim.account_capabilities WHERE social_account_id=$1 AND capability_code='publish_text'",
          [account.id],
        )
      ).available,
      true,
    );
    await f.db.query(
      "UPDATE custom_dim.account_integrations SET last_tested_at=NULL WHERE id=$1",
      [integration.id],
    );
    await monitorAccounts(f.db, vault, async () => {
      throw new Error("Provider down");
    });
    assert.equal(
      (
        await one(
          f.db,
          "SELECT available FROM custom_dim.account_capabilities WHERE social_account_id=$1 AND capability_code='publish_text'",
          [account.id],
        )
      ).available,
      false,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT integration_status FROM custom_dim.social_accounts WHERE id=$1",
          [account.id],
        )
      ).integration_status,
      "degraded",
    );
    await f.db.query(
      "UPDATE custom_dim.account_integrations SET last_tested_at=NULL WHERE id=$1",
      [integration.id],
    );
    await monitorAccounts(f.db, vault, async () => {
      await f.db.query(
        "UPDATE custom_dim.account_integrations SET status='revoked' WHERE id=$1",
        [integration.id],
      );
      return { publish: true, readMessages: true, sendMessages: true };
    });
    assert.equal(
      (
        await one(
          f.db,
          "SELECT available FROM custom_dim.account_capabilities WHERE social_account_id=$1 AND capability_code='publish_text'",
          [account.id],
        )
      ).available,
      false,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.account_health_checks")).rows
        .length,
      2,
    );
  } finally {
    await f.db.close();
  }
});
test("analytics compares equal periods and currencies, and collection without posts makes no external calls", async () => {
  const f = await fixture();
  try {
    for (const [amount, currency, date] of [
      ["10.10", "BRL", "2026-09-10"],
      ["20.20", "BRL", "2026-10-10"],
      ["3.00", "USD", "2026-10-10"],
    ])
      await insert(f.db, "revenue_events", {
        organization_id: f.org.id,
        amount,
        currency,
        source: "test",
        occurred_at: `${date}T12:00:00Z`,
      });
    await insert(f.db, "revenue_events", {
      organization_id: f.other.id,
      amount: "999",
      currency: "BRL",
      source: "foreign",
      occurred_at: "2026-10-10T12:00:00Z",
    });
    const report = await analytics(f.db, f.actor, {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-31T00:00:00Z",
    });
    assert.equal(
      report.financial.find((r) => r.currency === "BRL").amount,
      "20.20",
    );
    assert.equal(
      report.financial.find((r) => r.currency === "USD").amount,
      "3.00",
    );
    assert.equal(
      report.previous.financial.find((r) => r.currency === "BRL").amount,
      "10.10",
    );
    assert.deepEqual(report.metrics, []);
    let calls = 0;
    await collectMetrics(
      f.db,
      {
        get: async () => {
          calls++;
          return { token: "test" };
        },
        put: async () => {},
      },
      (async () => {
        calls++;
        return Response.json({});
      }) as typeof fetch,
    );
    assert.equal(calls, 0);
  } finally {
    await f.db.close();
  }
});
