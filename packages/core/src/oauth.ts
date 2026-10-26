import { randomBytes, randomUUID } from "node:crypto";
import { demand, type Actor } from "../../contracts/src/index";
import { insert, one, type DB, type Database } from "../../db/src/index";
import { type Vault } from "../../connectors/src/index";
import {
  exchangeOAuth,
  oauthAuthorize,
  oauthClient,
  renewOAuth,
  type OAuthGrant,
  type OAuthProvider,
  type OAuthProvidersConfig,
} from "../../connectors/src/oauth-multichannel";
import { audit, authorize, hash, resource, scoped } from "./security";
import { loadActor } from "./access";

const providerFor = (channel: string): OAuthProvider | undefined =>
  channel === "x"
    ? "x"
    : channel === "youtube"
      ? "google"
      : ["facebook", "instagram"].includes(channel)
        ? "meta"
        : undefined;
async function accountGuard(db: DB, actor: Actor, accountId: string) {
  authorize(actor, "security.write");
  const account = await resource(db, "social_accounts", accountId, actor);
  authorize(actor, "accounts.write", {
    influencerId: account.influencer_id,
    accountId,
  });
  const identity = await resource(
    db,
    "influencers",
    account.influencer_id,
    actor,
  );
  demand(
    !["offboarding", "archived", "restricted"].includes(identity.status) &&
      !["closed", "archived", "revoked"].includes(account.account_status),
    "OAUTH_ACCOUNT_DISABLED",
    "Conta ou identidade indisponível para autorização",
    409,
  );
  const platform = await one(
    db,
    "SELECT code FROM custom_dim.platforms WHERE id=$1",
    [account.platform_id],
  );
  const provider = providerFor(platform?.code);
  demand(
    provider,
    "OAUTH_PROVIDER_UNSUPPORTED",
    "Canal não possui OAuth neste fluxo",
    422,
  );
  return { account, channel: platform.code as string, provider };
}
export async function beginChannelOAuth(
  db: DB,
  actor: Actor,
  accountId: string,
  vault: Vault,
  config: OAuthProvidersConfig,
) {
  const { account, channel, provider } = await accountGuard(
    db,
    actor,
    accountId,
  );
  const client = oauthClient(config, provider),
    state = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const ref = `dim/${actor.organizationId}/${accountId}/oauth-${hash(state)}`;
  await vault.put(ref, { verifier });
  const op = await insert(db, "operation_jobs", {
    organization_id: actor.organizationId,
    subject_id: accountId,
    job_type: `oauth.connect.${provider}`,
    status: "awaiting_callback",
    idempotency_key: hash(state),
    payload: {
      requested_by: actor.userId,
      requested_aal: actor.aal,
      vault_ref: ref,
      redirect_uri: client.redirectUri,
      channel,
      account_updated_at: account.updated_at,
      expires_at: new Date(Date.now() + 600000).toISOString(),
    },
  });
  await audit(db, actor, "oauth_started", "social_accounts", accountId, {
    provider,
    operation_id: op.id,
  });
  return {
    operation_id: op.id,
    authorization_url: oauthAuthorize(provider, client, state, verifier),
    expires_in: 600,
  };
}
export async function finishChannelOAuth(
  db: Database,
  provider: OAuthProvider,
  state: string,
  code: string,
  vault: Vault,
  config: OAuthProvidersConfig,
  fetcher: typeof fetch = fetch,
) {
  demand(
    /^[A-Za-z0-9_-]{43}$/.test(state) && code.length > 0 && code.length <= 4096,
    "OAUTH_CALLBACK_INVALID",
    "Callback OAuth inválido",
    400,
  );
  const client = oauthClient(config, provider);
  const operation = await one(
    db,
    "UPDATE custom_dim.operation_jobs SET status='exchanging' WHERE job_type=$1 AND idempotency_key=$2 AND status='awaiting_callback' AND (payload->>'expires_at')::timestamptz>clock_timestamp() RETURNING *",
    [`oauth.connect.${provider}`, hash(state)],
  );
  demand(
    operation,
    "OAUTH_STATE_INVALID",
    "Autorização expirada ou já utilizada",
    409,
  );
  try {
    const actor = await loadActor(
      db,
      operation.payload.requested_by,
      operation.organization_id,
      operation.payload.requested_aal,
      operation.id,
    );
    await scoped(db, actor, (tx) =>
      accountGuard(tx, actor, operation.subject_id),
    );
    demand(
      operation.payload.redirect_uri === client.redirectUri,
      "OAUTH_CALLBACK_CHANGED",
      "Callback configurado mudou",
      409,
    );
    const { verifier } = await vault.get(operation.payload.vault_ref);
    const grant = await exchangeOAuth(
      provider,
      client,
      code,
      verifier,
      fetcher,
    );
    const fresh = await loadActor(
      db,
      actor.userId,
      actor.organizationId,
      actor.aal,
      operation.id,
    );
    return scoped(db, fresh, async (tx) => {
      const { account, channel } = await accountGuard(
        tx,
        fresh,
        operation.subject_id,
      );
      demand(
        new Date(account.updated_at).getTime() ===
          new Date(operation.payload.account_updated_at).getTime(),
        "OAUTH_ACCOUNT_CHANGED",
        "Conta mudou durante autorização; inicie novamente",
        409,
      );
      const choices = grant.choices.filter(
        (option) =>
          option.channel === channel &&
          (!account.external_id || option.id === account.external_id),
      );
      demand(
        choices.length > 0,
        "OAUTH_OWNER_MISMATCH",
        "Nenhuma conta autorizada corresponde ao destino solicitado",
        409,
      );
      await vault.put(operation.payload.vault_ref, {
        grant: JSON.stringify({ choices }),
      });
      await tx.query(
        "UPDATE custom_dim.operation_jobs SET status='awaiting_selection' WHERE id=$1 AND status='exchanging'",
        [operation.id],
      );
      return {
        authorization_received: true,
        operation_id: operation.id,
        account_id: account.id,
        message:
          "Retorne ao DIM para selecionar e confirmar a conta autorizada.",
      };
    });
  } catch (error) {
    await db.query(
      "UPDATE custom_dim.operation_jobs SET status='failed',last_error='OAUTH_CONNECTION_FAILED' WHERE id=$1 AND status='exchanging'",
      [operation.id],
    );
    throw error;
  }
}
async function selection(
  db: DB,
  actor: Actor,
  accountId: string,
  operationId: string,
) {
  const current = await accountGuard(db, actor, accountId);
  const operation = await resource(db, "operation_jobs", operationId, actor);
  demand(
    operation.subject_id === accountId &&
      operation.payload.requested_by === actor.userId &&
      operation.job_type === `oauth.connect.${current.provider}` &&
      operation.status === "awaiting_selection" &&
      new Date(operation.payload.expires_at).getTime() > Date.now(),
    "OAUTH_SELECTION_INVALID",
    "Seleção não pertence à autorização atual",
    409,
  );
  demand(
    new Date(current.account.updated_at).getTime() ===
      new Date(operation.payload.account_updated_at).getTime(),
    "OAUTH_ACCOUNT_CHANGED",
    "Conta mudou durante autorização; inicie novamente",
    409,
  );
  return { ...current, operation };
}
export async function channelOAuthChoices(
  db: DB,
  actor: Actor,
  accountId: string,
  operationId: string,
  vault: Vault,
) {
  const { operation } = await selection(db, actor, accountId, operationId);
  const grant: OAuthGrant = JSON.parse(
    (await vault.get(operation.payload.vault_ref)).grant || "{}",
  );
  demand(
    Array.isArray(grant.choices),
    "OAUTH_GRANT_MISSING",
    "Autorização não disponível",
    409,
  );
  return {
    choices: grant.choices.map(({ id, label, channel }) => ({
      id,
      label,
      channel,
    })),
  };
}
export async function selectChannelOAuth(
  db: DB,
  actor: Actor,
  accountId: string,
  operationId: string,
  externalId: string,
  vault: Vault,
) {
  await db.query(
    "SELECT id FROM custom_dim.operation_jobs WHERE id=$1 FOR UPDATE",
    [operationId],
  );
  const { account, channel, provider, operation } = await selection(
    db,
    actor,
    accountId,
    operationId,
  );
  const grant: OAuthGrant = JSON.parse(
    (await vault.get(operation.payload.vault_ref)).grant || "{}",
  );
  const choice = grant.choices?.find(
    (option) => option.id === externalId && option.channel === channel,
  );
  demand(
    choice && (!account.external_id || account.external_id === choice.id),
    "OAUTH_OWNER_MISMATCH",
    "Seleção deve pertencer à conta autorizada",
    403,
  );
  // New immutable secret reference prevents rotating credentials used by a concurrently revoked integration.
  const ref = `dim/${actor.organizationId}/${accountId}/oauth-token-${randomUUID()}`;
  await vault.put(ref, choice.secret);
  const connector = await one(
    db,
    "SELECT id FROM custom_dim.connectors WHERE platform_id=$1 AND enabled=true ORDER BY created_at LIMIT 1",
    [account.platform_id],
  );
  demand(connector, "OAUTH_CONNECTOR_DISABLED", "Conector não habilitado", 409);
  await txRecheck(db, actor, accountId, operationId);
  await db.query(
    "UPDATE custom_dim.account_integrations SET status='revoked' WHERE social_account_id=$1 AND status='active'",
    [accountId],
  );
  const integration = await insert(db, "account_integrations", {
    organization_id: actor.organizationId,
    social_account_id: accountId,
    connector_id: connector.id,
    auth_type: "oauth2",
    secret_ref: ref,
    granted_scopes: choice.scopes,
    expires_at: choice.expiresAt,
    status: "active",
  });
  await db.query(
    "UPDATE custom_dim.social_accounts SET external_id=$1,handle=$2,account_status='active',integration_status='pending_verification' WHERE id=$3",
    [choice.id, choice.label, accountId],
  );
  await db.query(
    "UPDATE custom_dim.account_capabilities SET available=false,restriction_reason='OAUTH_HEALTH_REQUIRED' WHERE social_account_id=$1",
    [accountId],
  );
  await db.query(
    "UPDATE custom_dim.operation_jobs SET status='completed',payload=payload-'vault_ref' WHERE id=$1",
    [operationId],
  );
  await audit(db, actor, "oauth_connected", "social_accounts", accountId, {
    provider,
    integration_id: integration.id,
    scopes: choice.scopes,
  });
  return { connected: true, health_required: true, account_id: accountId };
}
async function txRecheck(
  db: DB,
  actor: Actor,
  accountId: string,
  operationId: string,
) {
  const fresh = await loadActor(
    db,
    actor.userId,
    actor.organizationId,
    actor.aal,
    actor.correlationId,
  );
  await selection(db, fresh, accountId, operationId);
}
export async function refreshOAuthIntegrations(
  db: Database,
  vault: Vault,
  config: OAuthProvidersConfig,
  fetcher: typeof fetch = fetch,
  accountId?: string,
) {
  const candidates = (
    await db.query(
      `SELECT i.*,a.external_id,a.account_status,p.code AS channel FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id JOIN custom_dim.platforms p ON p.id=a.platform_id WHERE i.status='active' AND a.account_status='active' AND p.code IN('x','facebook','instagram','youtube') AND ($1::uuid IS NULL OR a.id=$1) AND ($1::uuid IS NOT NULL OR i.expires_at<now()+interval '15 minutes') ORDER BY i.expires_at LIMIT 25`,
      [accountId || null],
    )
  ).rows;
  let refreshed = 0;
  for (const integration of candidates) {
    const provider = providerFor(integration.channel)!;
    if (!config[provider]) continue;
    const marker = hash({
      integration: integration.id,
      ref: integration.secret_ref,
      expires: integration.expires_at,
    });
    const claim = await one(
      db,
      "INSERT INTO custom_dim.operation_jobs(organization_id,job_type,subject_id,status,idempotency_key,payload) VALUES($1,'oauth.refresh',$2,'refreshing',$3,'{}') ON CONFLICT DO NOTHING RETURNING id",
      [
        integration.organization_id,
        integration.social_account_id,
        `oauth-refresh:${marker}`,
      ],
    );
    if (!claim) continue;
    try {
      demand(
        integration.secret_ref.startsWith(
          `dim/${integration.organization_id}/${integration.social_account_id}/`,
        ),
        "OAUTH_VAULT_SCOPE",
        "Referência OAuth inválida",
        409,
      );
      const old = await vault.get(integration.secret_ref);
      const renewed = await renewOAuth(
        provider,
        oauthClient(config, provider),
        old,
        integration.external_id,
        integration.channel,
        integration.granted_scopes,
        fetcher,
      );
      const ref = `dim/${integration.organization_id}/${integration.social_account_id}/oauth-refresh-${randomUUID()}`;
      await vault.put(ref, renewed.secret);
      await db.transaction(async (tx) => {
        const current = await one(
          tx,
          "SELECT i.id FROM custom_dim.account_integrations i JOIN custom_dim.social_accounts a ON a.id=i.social_account_id WHERE i.id=$1 AND i.status='active' AND i.secret_ref=$2 AND a.account_status='active' FOR UPDATE OF i,a",
          [integration.id, integration.secret_ref],
        );
        if (!current) {
          await tx.query(
            "UPDATE custom_dim.operation_jobs SET status='cancelled' WHERE id=$1",
            [claim.id],
          );
          return;
        }
        await tx.query(
          "UPDATE custom_dim.account_integrations SET secret_ref=$1,expires_at=$2,granted_scopes=$3,last_tested_at=NULL WHERE id=$4",
          [ref, renewed.expiresAt, renewed.scopes, integration.id],
        );
        await tx.query(
          "UPDATE custom_dim.social_accounts SET integration_status='pending_verification' WHERE id=$1",
          [integration.social_account_id],
        );
        await tx.query(
          "UPDATE custom_dim.account_capabilities SET available=false,restriction_reason='OAUTH_HEALTH_REQUIRED' WHERE social_account_id=$1",
          [integration.social_account_id],
        );
        await tx.query(
          "UPDATE custom_dim.operation_jobs SET status='completed' WHERE id=$1",
          [claim.id],
        );
        refreshed++;
      });
    } catch {
      // Refresh can rotate a token before an interrupted response. Never replay the old refresh credential blindly.
      await db.query(
        "UPDATE custom_dim.operation_jobs SET status='requires_reauthorization',last_error='OAUTH_REAUTH_REQUIRED' WHERE id=$1",
        [claim.id],
      );
      await db.query(
        "UPDATE custom_dim.account_integrations SET status='requires_reauthorization' WHERE id=$1 AND status='active' AND secret_ref=$2",
        [integration.id, integration.secret_ref],
      );
      await db.query(
        "UPDATE custom_dim.social_accounts SET integration_status='degraded' WHERE id=$1 AND EXISTS(SELECT 1 FROM custom_dim.account_integrations WHERE id=$2 AND status='requires_reauthorization')",
        [integration.social_account_id, integration.id],
      );
    }
  }
  return { refreshed, checked: candidates.length };
}
