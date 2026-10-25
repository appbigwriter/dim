import { audienceProvider } from "../../../packages/connectors/src/audience";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { Redis } from "ioredis";
import { postgres, one } from "../../../packages/db/src/index";
import { migrate } from "../../../packages/db/src/migrate";
import { supabaseAuth } from "../../../packages/core/src/access";
import { demand } from "../../../packages/contracts/src/index";
import { HashicorpVault } from "../../../packages/connectors/src/index";
import { buildApp } from "./app";
import {
  supabaseStorage,
  clamScan,
} from "../../../packages/connectors/src/storage";
for (const key of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"])
  if (!process.env[key]) throw new Error(`Configure ${key}`);
const db = postgres(process.env.DATABASE_URL!);
if (process.env.AUTO_MIGRATE === "true") {
  console.log("[API] Executando migrações automáticas de banco de dados...");
  await migrate(db);
  console.log("[API] Migrações concluídas com sucesso.");
}
const client = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    })
  : undefined;
const vault =
  process.env.VAULT_ADDR && process.env.VAULT_TOKEN
    ? new HashicorpVault(
        process.env.VAULT_ADDR,
        process.env.VAULT_TOKEN,
        process.env.VAULT_MOUNT,
      )
    : undefined;
const storage = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? supabaseStorage(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    )
  : undefined;
const scan = process.env.CLAMAV_HOST
  ? (data: Buffer) =>
      clamScan(
        data,
        process.env.CLAMAV_HOST!,
        Number(process.env.CLAMAV_PORT || 3310),
      )
  : undefined;
const app = await buildApp({
  db,
  logger: true,
  vault,
  audience: vault
    ? audienceProvider(vault, fetch, process.env.APP_ENV === "development")
    : undefined,
  storage,
  scan,
  invite: process.env.SUPABASE_SERVICE_ROLE_KEY
    ? async (email, id) => {
        const admin = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data, error } = await admin.auth.admin.inviteUserByEmail(
          email,
          {
            redirectTo: `${process.env.WEB_ORIGIN || "http://localhost:3000"}/accept-invitation/${id}`,
          },
        );
        demand(
          !error && data.user,
          "INVITATION_FAILED",
          "Auth não confirmou o convite",
          502,
        );
        return { userId: data.user.id };
      }
    : undefined,
  authenticate: supabaseAuth(
    db,
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  ),
  session: async (token) => {
    const { data, error } = await client.auth.getUser(token);
    demand(!error && data.user, "INVALID_SESSION", "Sessão inválida", 401);
    const claims = decodeJwt(token);
    demand(
      claims.exp &&
        claims.exp > Date.now() / 1000 &&
        claims.session_id &&
        (await one(
          db,
          "SELECT id FROM auth.sessions WHERE id=$1 AND user_id=$2 AND (not_after IS NULL OR not_after>now())",
          [claims.session_id, data.user.id],
        )),
      "SESSION_REVOKED",
      "Sessão revogada",
      401,
    );
    return {
      userId: data.user.id,
      emailVerified: Boolean(data.user.email_confirmed_at),
      aal: String(decodeJwt(token).aal || "aal1"),
    };
  },
  dependencies: async () => {
    await db.query("SELECT 1");
    let queue = false;
    try {
      queue = (await redis?.ping()) === "PONG";
    } catch {
      /* readiness below */
    }
    return {
      database: "ready",
      redis: queue ? "ready" : "unavailable",
      ready: queue,
    };
  },
});
await app.listen({
  host:
    process.env.HOST ||
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  port: Number(process.env.PORT || 3001),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await redis?.quit();
    await db.close();
    process.exit(0);
  });
