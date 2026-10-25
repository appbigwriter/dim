import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { buildApp } from "../apps/api/src/app";
import { AppError } from "../packages/contracts/src/index";
import { loadActor } from "../packages/core/src/access";
import { insert } from "../packages/db/src/index";
test("API enforces auth, MFA, tenant, strict inputs, optimistic concurrency and dependency failures", async () => {
  const f = await fixture();
  const app = await buildApp({
    db: f.db,
    authenticate: async (token, org, correlation) => {
      if (token === "expired")
        throw new AppError(401, "SESSION_EXPIRED", "Sessão expirada");
      return loadActor(
        f.db,
        token === "editor" ? f.editor : f.admin,
        org,
        token === "aal1" ? "aal1" : "aal2",
        correlation,
      );
    },
    dependencies: async () => ({ ready: false }),
  });
  const headers = {
    authorization: "Bearer admin",
    "x-organization-id": f.org.id,
  };
  try {
    assert.equal(
      (await app.inject({ url: "/api/v1/influencers" })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/influencers",
          headers: { ...headers, authorization: "Bearer expired" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: "/api/v1/influencers",
          headers: { ...headers, authorization: "Bearer aal1" },
        })
      ).statusCode,
      403,
    );
    assert.equal((await app.inject({ url: "/health/ready" })).statusCode, 503);
    const body = {
      public_name: "Test",
      internal_name: "Internal",
      slug: "test",
      type: "virtual",
      owner_user_id: f.admin,
    };
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/influencers",
      headers,
      payload: { ...body, organization_id: f.other.id },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/influencers",
      headers,
      payload: body,
    });
    assert.equal(created.statusCode, 200, created.body);
    const identity = created.json();
    const wrong = await app.inject({
      url: `/api/v1/influencers/${identity.id}`,
      headers: { ...headers, "x-organization-id": f.other.id },
    });
    assert.equal(wrong.statusCode, 404, wrong.body);
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/influencers/${identity.id}`,
      headers,
      payload: { public_name: "Changed", row_version: 1 },
    });
    assert.equal(patched.statusCode, 200, patched.body);
    const stale = await app.inject({
      method: "PATCH",
      url: `/api/v1/influencers/${identity.id}`,
      headers,
      payload: { public_name: "Lost update", row_version: 1 },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    await f.db.query(
      "UPDATE custom_dim.influencers SET persona_source='legacy_local' WHERE id=$1",
      [identity.id],
    );
    const profile = {
      row_version: 2,
      biography_short: "Bio",
      value_proposition: "Contexto",
      audience: {},
      positioning: {},
      appearance_settings: {},
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/influencers/${identity.id}/profile`,
          headers,
          payload: profile,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/influencers/${identity.id}/profile`,
          headers,
          payload: profile,
        })
      ).statusCode,
      409,
    );
    const forms = await app.inject({ url: "/api/v1/forms", headers });
    assert.equal(forms.statusCode, 200, forms.body);
    assert.ok(forms.json().resources.influencers.schema.properties.slug);
    const negative = await app.inject({
      method: "POST",
      url: "/api/v1/costs",
      headers,
      payload: {
        influencer_id: identity.id,
        amount: "-1",
        currency: "BRL",
        cost_type: "test",
        occurred_at: new Date().toISOString(),
      },
    });
    assert.equal(negative.statusCode, 400);
    const audit = await app.inject({ url: "/api/v1/audit", headers });
    assert.equal(audit.statusCode, 200, audit.body);
    assert.ok(audit.json().data.length >= 2);
    assert.ok(audit.headers["x-correlation-id"]);
    const unknown = await app.inject({ url: "/does-not-exist" });
    assert.equal(unknown.statusCode, 404);
    const foreign = await insert(f.db, "influencers", {
      organization_id: f.other.id,
      code: "foreign",
      slug: "foreign",
      public_name: "Foreign",
      internal_name: "F",
      type: "human",
    });
    const link = await app.inject({
      method: "POST",
      url: "/api/v1/contents",
      headers,
      payload: {
        influencer_id: foreign.id,
        title: "Cross tenant",
        content_type: "text",
        objective: "Test",
      },
    });
    assert.equal(link.statusCode, 404);
    const invalidId = await app.inject({
      url: `/api/v1/influencers/${randomUUID()}`,
      headers,
    });
    assert.equal(invalidId.statusCode, 404);
  } finally {
    await app.close();
    await f.db.close();
  }
});
