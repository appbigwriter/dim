// Disposable UI fixture. This file is never imported by the application entrypoints.
import Fastify from "fastify";
import cors from "@fastify/cors";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { buildApp } from "../apps/api/src/app";
import { AppError } from "../packages/contracts/src/index";
import { loadActor } from "../packages/core/src/access";
import { createResource } from "../packages/core/src/resources";
import { scoped } from "../packages/core/src/security";
import { one, insert } from "../packages/db/src/index";
if (process.env.DIM_BROWSER_FIXTURE !== "1")
  throw new Error("Use DIM_BROWSER_FIXTURE=1 only for isolated browser tests");
const f = await fixture();
await scoped(f.db, f.actor, async (tx) => {
  const identity = await createResource(tx, f.actor, "influencers", {
    public_name: "Aurora · exemplo local",
    internal_name: "Aurora",
    slug: "aurora-fixture",
    type: "virtual",
    niche: "Cultura",
    owner_user_id: f.admin,
  });
  const platform = await one(
    tx,
    "SELECT id FROM custom_dim.platforms WHERE code='youtube'",
  );
  await insert(tx, "social_accounts", {
    organization_id: f.org.id,
    influencer_id: identity.id,
    platform_id: platform.id,
    account_type: "channel",
    handle: "Canal local de teste",
    external_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
  });
});
const user = {
  id: f.admin,
  aud: "authenticated",
  role: "authenticated",
  email: "dim@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  created_at: new Date().toISOString(),
  factors: [],
};
const b64 = (value: any) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: f.admin, aud: "authenticated", role: "authenticated", aal: "aal2", session_id: randomUUID(), exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture-signature`;
const auth = Fastify();
await auth.register(cors, { origin: true });
auth.post("/auth/v1/token", async () => ({
  access_token: token,
  refresh_token: "test-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
}));
auth.get("/auth/v1/user", async () => user);
auth.post("/auth/v1/logout", async () => ({}));
await auth.listen({ host: "127.0.0.1", port: 54329 });
const app = await buildApp({
  db: f.db,
  authenticate: async (t, org, c) => {
    if (t !== token) throw new AppError(401, "INVALID_SESSION", "Fixture only");
    return loadActor(f.db, f.admin, org, "aal2", c);
  },
  session: async (t) => {
    if (t !== token) throw new AppError(401, "INVALID_SESSION", "Fixture only");
    return { userId: f.admin, aal: "aal2" };
  },
});
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.DIM_FIXTURE_API_PORT || 3001),
});
console.log("Disposable UI fixture ready on loopback. No external connection.");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await auth.close();
    await f.db.close();
    process.exit(0);
  });
