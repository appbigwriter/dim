import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import {
  beginChannelOAuth,
  channelOAuthChoices,
  finishChannelOAuth,
  refreshOAuthIntegrations,
  selectChannelOAuth,
} from "../packages/core/src/oauth";
import {
  exchangeOAuth,
  oauthAuthorize,
  oauthClient,
  renewOAuth,
  type OAuthProvidersConfig,
} from "../packages/connectors/src/oauth-multichannel";
import type { Vault } from "../packages/connectors/src/index";

const channelA = `UC${"a".repeat(22)}`,
  channelB = `UC${"b".repeat(22)}`;
const googleScopes =
  "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const config: OAuthProvidersConfig = {
  google: {
    clientId: "google-client",
    clientSecret: "google-secret",
    redirectUri: "https://dim.example.org/api/v1/oauth/callback/google",
  },
  meta: {
    clientId: "meta-client",
    clientSecret: "meta-secret",
    redirectUri: "https://dim.example.org/api/v1/oauth/callback/meta",
    graphVersion: "v25.0",
  },
  x: {
    clientId: "x-client",
    clientSecret: "x-secret",
    redirectUri: "https://dim.example.org/api/v1/oauth/callback/x",
  },
};
function memoryVault() {
  const entries = new Map<string, Record<string, string>>();
  const vault: Vault = {
    get: async (ref) => ({ ...entries.get(ref) }),
    put: async (ref, values) => {
      entries.set(ref, { ...values });
    },
  };
  return { vault, entries };
}
async function setup(channel: string, externalId?: string) {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: `OA-${channel}`,
      slug: `oauth-${randomUUID()}`,
      public_name: "OAuth",
      internal_name: "OAuth",
      type: "virtual",
    });
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code=$1",
      [channel],
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
      external_id: externalId,
    });
    return { ...f, identity, platform, connector, account, ...memoryVault() };
  } catch (error) {
    await f.db.close();
    throw error;
  }
}
const googleFetch = (
  hook?: (url: string, init?: RequestInit) => Promise<void>,
): typeof fetch =>
  (async (url: any, init?: RequestInit) => {
    assert.equal(init?.redirect, "error");
    await hook?.(String(url), init);
    if (String(url).endsWith("/token"))
      return Response.json({
        access_token: "new-google-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
        scope: googleScopes,
      });
    return Response.json({
      items: [
        { id: channelA, snippet: { title: "Channel A" } },
        { id: channelB, snippet: { title: "Channel B" } },
      ],
    });
  }) as typeof fetch;
test("Google guided OAuth uses S256, single-use state, safe choices and owner-confirmed selection without token exposure", async () => {
  const f = await setup("youtube", channelA);
  try {
    const started = await scoped(f.db, f.actor, (tx) =>
      beginChannelOAuth(tx, f.actor, f.account.id, f.vault, config),
    );
    const authorization = new URL(started.authorization_url);
    assert.equal(authorization.hostname, "accounts.google.com");
    assert.equal(
      authorization.searchParams.get("code_challenge_method"),
      "S256",
    );
    assert.equal(authorization.searchParams.get("access_type"), "offline");
    const state = authorization.searchParams.get("state")!;
    const result = await finishChannelOAuth(
      f.db,
      "google",
      state,
      "authorization-code",
      f.vault,
      config,
      googleFetch(async (url, init) => {
        if (url.endsWith("/token")) {
          const params = new URLSearchParams(String(init?.body));
          assert.equal(params.get("code"), "authorization-code");
          assert.equal(params.get("client_secret"), "google-secret");
          assert.equal(params.get("code_verifier")?.length, 64);
        }
      }),
    );
    assert.equal(result.authorization_received, true);
    await assert.rejects(
      () =>
        finishChannelOAuth(
          f.db,
          "google",
          state,
          "replayed",
          f.vault,
          config,
          googleFetch(),
        ),
      /já utilizada/,
    );
    const choices = await scoped(f.db, f.actor, (tx) =>
      channelOAuthChoices(
        tx,
        f.actor,
        f.account.id,
        started.operation_id,
        f.vault,
      ),
    );
    assert.deepEqual(choices.choices, [
      { id: channelA, label: "Channel A", channel: "youtube" },
    ]);
    assert.equal(JSON.stringify(choices).includes("access"), false);
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          selectChannelOAuth(
            tx,
            f.actor,
            f.account.id,
            started.operation_id,
            channelB,
            f.vault,
          ),
        ),
      /Seleção/,
    );
    await assert.rejects(() =>
      scoped(f.db, f.reviewActor, (tx) =>
        channelOAuthChoices(
          tx,
          f.reviewActor,
          f.account.id,
          started.operation_id,
          f.vault,
        ),
      ),
    );
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          selectChannelOAuth(
            tx,
            f.actor,
            f.account.id,
            started.operation_id,
            channelA,
            f.vault,
          ),
        )
      ).health_required,
      true,
    );
    const integration = await one(
      f.db,
      "SELECT * FROM custom_dim.account_integrations WHERE social_account_id=$1 AND status='active'",
      [f.account.id],
    );
    assert.equal(
      (await f.vault.get(integration.secret_ref)).token,
      "new-google-access",
    );
    assert.equal(
      JSON.stringify(integration).includes("new-google-access"),
      false,
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT integration_status FROM custom_dim.social_accounts WHERE id=$1",
          [f.account.id],
        )
      ).integration_status,
      "pending_verification",
    );
  } finally {
    await f.db.close();
  }
});
test("OAuth callback cannot bind another remote owner, changed callback, expired state or revoked member", async () => {
  const f = await setup("youtube", "UC" + "z".repeat(22));
  try {
    const start = () =>
      scoped(f.db, f.actor, (tx) =>
        beginChannelOAuth(tx, f.actor, f.account.id, f.vault, config),
      );
    const first = await start();
    await assert.rejects(
      () =>
        finishChannelOAuth(
          f.db,
          "google",
          new URL(first.authorization_url).searchParams.get("state")!,
          "code",
          f.vault,
          config,
          googleFetch(),
        ),
      /Nenhuma conta/,
    );
    const expired = await start();
    await f.db.query(
      "UPDATE custom_dim.operation_jobs SET payload=jsonb_set(payload,'{expires_at}',to_jsonb((now()-interval '1 minute')::text)) WHERE id=$1",
      [expired.operation_id],
    );
    await assert.rejects(
      () =>
        finishChannelOAuth(
          f.db,
          "google",
          new URL(expired.authorization_url).searchParams.get("state")!,
          "code",
          f.vault,
          config,
          googleFetch(),
        ),
      /expirada/,
    );
    const revoked = await start();
    await f.db.query(
      "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
      [f.org.id, f.actor.userId],
    );
    await assert.rejects(() =>
      finishChannelOAuth(
        f.db,
        "google",
        new URL(revoked.authorization_url).searchParams.get("state")!,
        "code",
        f.vault,
        config,
        googleFetch(),
      ),
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT count(*)::int AS n FROM custom_dim.account_integrations",
        )
      ).n,
      0,
    );
  } finally {
    await f.db.close();
  }
});
test("Meta code exchange returns only Pages with create permission and their linked Instagram account", async () => {
  let pageCalls = 0;
  const permissions = [
    "pages_show_list",
    "pages_read_engagement",
    "pages_manage_posts",
    "instagram_basic",
    "instagram_content_publish",
  ];
  const grant = await exchangeOAuth(
    "meta",
    oauthClient(config, "meta"),
    "code",
    "unused",
    (async (url: any, init?: RequestInit) => {
      const target = new URL(url);
      assert.equal(target.hostname, "graph.facebook.com");
      assert.equal(init?.redirect, "error");
      if (target.pathname.endsWith("oauth/access_token"))
        return Response.json({
          access_token: target.searchParams.has("fb_exchange_token")
            ? "long-user-token"
            : "short-user-token",
          expires_in: 5184000,
        });
      if (target.pathname.endsWith("permissions"))
        return Response.json({
          data: permissions.map((permission) => ({
            permission,
            status: "granted",
          })),
        });
      pageCalls++;
      return Response.json({
        data: [
          {
            id: "123",
            name: "Approved Page",
            access_token: "page-secret",
            tasks: ["CREATE_CONTENT"],
            instagram_business_account: { id: "456", username: "approved-ig" },
          },
          { id: "789", access_token: "unauthorized", tasks: ["ANALYZE"] },
        ],
      });
    }) as typeof fetch,
  );
  assert.equal(pageCalls, 1);
  assert.deepEqual(
    grant.choices.map((c) => [c.id, c.channel]),
    [
      ["123", "facebook"],
      ["456", "instagram"],
    ],
  );
  assert.equal(
    grant.choices[0].secret.app_access_token,
    "meta-client|meta-secret",
  );
  await assert.rejects(
    () =>
      renewOAuth(
        "meta",
        oauthClient(config, "meta"),
        { user_token: "expired", user_expires_at: new Date().toISOString() },
        "123",
        "facebook",
        permissions,
      ),
    /titular/,
  );
});
test("refresh rotates immutable Vault reference but never revives an integration revoked during token exchange", async () => {
  for (const revoked of [false, true]) {
    const f = await setup("youtube", channelA);
    try {
      await f.db.query(
        "UPDATE custom_dim.social_accounts SET account_status='active',integration_status='connected' WHERE id=$1",
        [f.account.id],
      );
      const oldRef = `dim/${f.org.id}/${f.account.id}/old-google-token`;
      await f.vault.put(oldRef, {
        token: "old-token",
        refresh_token: "old-refresh",
      });
      const integration = await insert(f.db, "account_integrations", {
        organization_id: f.org.id,
        social_account_id: f.account.id,
        connector_id: f.connector.id,
        auth_type: "oauth2",
        secret_ref: oldRef,
        status: "active",
        granted_scopes: googleScopes.split(" "),
        expires_at: new Date(Date.now() + 1000).toISOString(),
      });
      let exchanges = 0;
      const transport = googleFetch(async (url, init) => {
        if (!url.endsWith("/token")) return;
        exchanges++;
        const body = new URLSearchParams(String(init?.body));
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "old-refresh");
        if (revoked)
          await f.db.query(
            "UPDATE custom_dim.account_integrations SET status='revoked' WHERE id=$1",
            [integration.id],
          );
      });
      const result = await refreshOAuthIntegrations(
        f.db,
        f.vault,
        config,
        transport,
      );
      const current = await one(
        f.db,
        "SELECT * FROM custom_dim.account_integrations WHERE id=$1",
        [integration.id],
      );
      assert.equal(result.refreshed, revoked ? 0 : 1);
      assert.equal(current.status, revoked ? "revoked" : "active");
      assert.equal((await f.vault.get(oldRef)).token, "old-token");
      if (!revoked) {
        assert.notEqual(current.secret_ref, oldRef);
        assert.equal(
          (await f.vault.get(current.secret_ref)).refresh_token,
          "rotated-refresh",
        );
      }
      await refreshOAuthIntegrations(f.db, f.vault, config, transport);
      assert.equal(exchanges, 1);
    } finally {
      await f.db.close();
    }
  }
});
test("X refresh binds scopes, rotation and exact remote owner; authorize uses S256", async () => {
  const client = oauthClient(config, "x");
  const url = new URL(
    oauthAuthorize("x", client, "randomstate", "randomverifier"),
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  const transport = (async (url: any, _init?: RequestInit) =>
    String(url).endsWith("token")
      ? Response.json({
          access_token: "new-x-token",
          refresh_token: "new-refresh",
          expires_in: 7200,
          scope: "tweet.read tweet.write users.read offline.access",
        })
      : Response.json({
          data: { id: "123", username: "owner" },
        })) as typeof fetch;
  const result = await renewOAuth(
    "x",
    client,
    { refresh_token: "old-refresh" },
    "123",
    "x",
    [],
    transport,
  );
  assert.equal(result.secret.refresh_token, "new-refresh");
  await assert.rejects(
    () =>
      renewOAuth(
        "x",
        client,
        { refresh_token: "old-refresh" },
        "999",
        "x",
        [],
        transport,
      ),
    /conta vinculada/,
  );
  assert.throws(
    () =>
      oauthClient(
        {
          google: {
            clientId: "x",
            clientSecret: "y",
            redirectUri: "http://untrusted.example.org/callback",
          },
        },
        "google",
      ),
    /HTTPS/,
  );
});
