import { randomBytes, createHash } from "node:crypto";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, one, type DB, type Database } from "../../db/src/index";
import {
  audit,
  authorize,
  hash,
  resource,
  scoped,
} from "../../core/src/security";
import { loadActor } from "../../core/src/access";
import { type Vault } from "./index";
type OAuthConfig = {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  fetch?: typeof fetch;
};
export async function beginX(
  db: DB,
  actor: Actor,
  accountId: string,
  vault: Vault,
  config: OAuthConfig,
) {
  authorize(actor, "security.write");
  const account = await resource(db, "social_accounts", accountId, actor);
  const platform = await one(
    db,
    "SELECT code FROM custom_dim.platforms WHERE id=$1",
    [account.platform_id],
  );
  demand(
    platform?.code === "x",
    "PROVIDER_MISMATCH",
    "OAuth configurado para X",
  );
  demand(
    new URL(config.redirectUri).protocol === "https:" ||
      process.env.APP_ENV === "development",
    "TLS_REQUIRED",
    "Callback exige HTTPS",
  );
  const state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const ref = `dim/${actor.organizationId}/${account.id}/oauth-${hash(state)}`;
  await vault.put(ref, { verifier });
  await insert(db, "operation_jobs", {
    organization_id: actor.organizationId,
    job_type: "oauth.x",
    subject_id: account.id,
    status: "awaiting_callback",
    idempotency_key: hash(state),
    payload: {
      requested_by: actor.userId,
      vault_ref: ref,
      expires_at: new Date(Date.now() + 600000).toISOString(),
      redirect_uri: config.redirectUri,
    },
  });
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "tweet.read tweet.write users.read offline.access",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  await audit(db, actor, "oauth_start", "social_accounts", account.id);
  return { authorization_url: url.toString() };
}
export async function finishX(
  db: Database,
  state: string,
  code: string,
  vault: Vault,
  config: OAuthConfig,
) {
  demand(
    state.length >= 32 && code.length > 0,
    "INVALID_CALLBACK",
    "Callback inválido",
    400,
  );
  const operation = await one(
    db,
    "UPDATE custom_dim.operation_jobs SET status='exchanging' WHERE job_type='oauth.x' AND idempotency_key=$1 AND status='awaiting_callback' AND (payload->>'expires_at')::timestamptz>now() RETURNING *",
    [hash(state)],
  );
  demand(
    operation,
    "OAUTH_STATE_INVALID",
    "State expirado ou já utilizado",
    400,
  );
  const actor = await loadActor(
    db,
    operation.payload.requested_by,
    operation.organization_id,
    "aal2",
    operation.correlation_id || operation.id,
  );
  authorize(actor, "security.write");
  demand(
    operation.payload.redirect_uri === config.redirectUri,
    "CALLBACK_MISMATCH",
    "Callback alterado",
    400,
  );
  const { verifier } = await vault.get(operation.payload.vault_ref);
  const transport = config.fetch || fetch;
  const response = await transport("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(config.clientSecret
        ? {
            Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          }
        : {}),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
      client_id: config.clientId,
    }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  demand(
    response.ok,
    "OAUTH_EXCHANGE_FAILED",
    "Não foi possível trocar a autorização",
    502,
  );
  const token = await response.json();
  demand(
    token.access_token && token.expires_in && token.scope,
    "INVALID_PROVIDER_RESPONSE",
    "Resposta OAuth inválida",
    502,
  );
  const profile = await transport("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  demand(
    profile.ok,
    "OAUTH_PROFILE_FAILED",
    "Identidade da conta não verificada",
    502,
  );
  const user = (await profile.json()).data;
  const ref = `dim/${actor.organizationId}/${operation.subject_id}/x`;
  await vault.put(ref, {
    token: token.access_token,
    ...(token.refresh_token ? { refresh_token: token.refresh_token } : {}),
  });
  return scoped(db, actor, async (tx) => {
    const account = await resource(
      tx,
      "social_accounts",
      operation.subject_id,
      actor,
    );
    demand(
      !account.external_id || account.external_id === String(user.id),
      "ACCOUNT_OWNER_MISMATCH",
      "A conta autorizada difere da conta solicitada",
      403,
    );
    const connector = await one(
      tx,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1 AND code='x-oauth2' AND enabled=true",
      [account.platform_id],
    );
    demand(connector, "CONNECTOR_DISABLED", "Conector não habilitado");
    await tx.query(
      "UPDATE custom_dim.account_integrations SET status='revoked' WHERE social_account_id=$1 AND status='active'",
      [account.id],
    );
    const scopes = String(token.scope).split(" ");
    await insert(tx, "account_integrations", {
      organization_id: actor.organizationId,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "oauth2_pkce",
      secret_ref: ref,
      granted_scopes: scopes,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      last_tested_at: new Date().toISOString(),
      status: "active",
    });
    await tx.query(
      "UPDATE custom_dim.social_accounts SET external_id=$1,handle=$2,integration_status='connected',account_status='active' WHERE id=$3",
      [String(user.id), user.username, account.id],
    );
    await tx.query(
      "INSERT INTO custom_dim.account_capabilities(organization_id,social_account_id,capability_code,available,checked_at) VALUES($1,$2,'publish_text',$3,now()) ON CONFLICT(social_account_id,capability_code) DO UPDATE SET available=excluded.available,checked_at=now()",
      [
        actor.organizationId,
        account.id,
        scopes.includes("tweet.write") && scopes.includes("users.read"),
      ],
    );
    await tx.query(
      "UPDATE custom_dim.operation_jobs SET status='completed',payload=payload-'vault_ref' WHERE id=$1",
      [operation.id],
    );
    await audit(tx, actor, "oauth_connected", "social_accounts", account.id, {
      scopes,
    });
    return { connected: true, account_id: account.id };
  });
}
