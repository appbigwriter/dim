import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helpers";
import { buildApp } from "../apps/api/src/app";
import {
  verifySimpleToken,
  validateSimpleSession,
} from "../packages/core/src/simple-auth";
import { loadActor } from "../packages/core/src/access";
test("local authentication is opt-in, never grants roles or MFA, requires password and checks revocation", async () => {
  const names = [
    "APP_ENV",
    "NODE_ENV",
    "DIM_ALLOW_LOCAL_AUTH",
    "AUTH_SECRET",
    "ADMIN_PASSWORD",
    "ADMIN_EMAIL",
    "ADMIN_USER_ID",
  ];
  const old = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const f = await fixture();
  const app = await buildApp({ db: f.db, authenticate: async () => f.actor });
  try {
    delete process.env.DIM_ALLOW_LOCAL_AUTH;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/simple-login",
          payload: { email: "dev@example.org" },
        })
      ).statusCode,
      404,
    );
    Object.assign(process.env, {
      APP_ENV: "development",
      NODE_ENV: "test",
      DIM_ALLOW_LOCAL_AUTH: "true",
      AUTH_SECRET: "test-only-random-secret-at-least-32-characters",
      ADMIN_PASSWORD: "test-only-long-password",
      ADMIN_EMAIL: "dev@example.org",
      ADMIN_USER_ID: f.admin,
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/simple-login",
          payload: { email: "dev@example.org" },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/auth/simple-login",
          payload: {
            email: "dev@example.org",
            password: "wrong-password-long",
          },
        })
      ).statusCode,
      401,
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/v1/auth/simple-login",
      payload: {
        email: "dev@example.org",
        password: "test-only-long-password",
      },
    });
    assert.equal(result.statusCode, 200);
    const token = result.json().token;
    const claims = await verifySimpleToken(token);
    assert.equal(claims?.aal, "aal1");
    await validateSimpleSession(f.db, claims!);
    await assert.rejects(
      () => loadActor(f.db, claims!.sub, f.org.id, claims!.aal, "test"),
      /segundo fator/,
    );
    await f.db.query("DELETE FROM auth.sessions WHERE id=$1", [
      claims!.session_id,
    ]);
    await assert.rejects(
      () => validateSimpleSession(f.db, claims!),
      /revogada/,
    );
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(await verifySimpleToken(token), null);
  } finally {
    for (const n of names)
      if (old[n] === undefined) delete process.env[n];
      else process.env[n] = old[n];
    await app.close();
    await f.db.close();
  }
});
