import { audienceProvider } from "../../../packages/connectors/src/audience";
import { audienceActions } from "../../../packages/connectors/src/audience-actions";
import { oauthConfigFromEnvironment } from "../../../packages/connectors/src/oauth-multichannel";
import { erasureProvider } from "../../../packages/connectors/src/retention";
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { Redis } from "ioredis";
import { postgres, one } from "../../../packages/db/src/index";
import { migrate } from "../../../packages/db/src/migrate";
import { supabaseAuth, loadActor } from "../../../packages/core/src/access";
import {
  verifySimpleToken,
  validateSimpleSession,
} from "../../../packages/core/src/simple-auth";
import { demand } from "../../../packages/contracts/src/index";
import { HashicorpVault } from "../../../packages/connectors/src/index";
import { buildApp } from "./app";
import {
  supabaseStorage,
  clamScan,
} from "../../../packages/connectors/src/storage";
const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const supabaseUrl = process.env.SUPABASE_URL || "https://supabase-control-tower-api.fbr.news";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy";

if (!process.env.DATABASE_URL) {
  console.warn("[API] AVISO: DATABASE_URL não configurada no ambiente.");
}

const db = postgres(dbUrl);
if (process.env.AUTO_MIGRATE === "true" && process.env.DATABASE_URL) {
  try {
    console.log("[API] Executando migrações automáticas de banco de dados...");
    await migrate(db);
    console.log("[API] Migrações concluídas com sucesso.");
  } catch (err: any) {
    console.error("[API] Aviso: Falha ao executar migrações automáticas:", err.message);
  }
}
const client = createClient(
  supabaseUrl,
  supabaseAnonKey,
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
  oauth: oauthConfigFromEnvironment(),
  erasure: vault ? erasureProvider(vault) : undefined,
  audience: vault
    ? audienceProvider(vault, fetch, process.env.APP_ENV === "development")
    : undefined,
  audienceActions: vault
    ? audienceActions(vault, fetch, process.env.APP_ENV === "development")
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
  authenticate: async (token, org, correlationId) => {
    const simple = await verifySimpleToken(token);
    if (simple?.sub) {
      await validateSimpleSession(db, simple);
      return loadActor(db, simple.sub, org, simple.aal, correlationId);
    }
    const fallback = supabaseAuth(
      db,
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_ANON_KEY!,
    );
    return fallback(token, org, correlationId);
  },
  session: async (token) => {
    const simple = await verifySimpleToken(token);
    if (simple?.sub) {
      try {
        await validateSimpleSession(db, simple);
      } catch (e) {
        console.warn("[session] aviso ao validar sessão local:", e);
      }
      return {
        userId: simple.sub,
        email: simple.email,
        emailVerified: true,
        aal: simple.aal,
      };
    }
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
console.log(`[API] DIM Fastify API escutando em http://${process.env.HOST || "0.0.0.0"}:${Number(process.env.PORT || 3001)}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    await redis?.quit();
    await db.close();
    process.exit(0);
  });
