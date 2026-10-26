import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FacebookConnector,
  InstagramConnector,
  YouTubeConnector,
  DelegatedChannelConnector,
  channelConnector,
  type MediaResolver,
} from "../packages/connectors/src/channels";
import { ProviderFailure } from "../packages/connectors/src/index";

const meta = {
  graph_version: "v25.0",
  app_access_token: "app-secret",
  app_id: "app",
  page_id: "123",
  media_allowed_origins: '["https://media.example.org"]',
};
const input = {
  token: "private-token",
  destination: "123",
  text: "Approved copy",
  idempotencyKey: "publication-1",
};
function response(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers });
}
function graph(
  scopes: string[],
  hook?: (url: string, init?: RequestInit) => Response | undefined,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    assert.equal(init?.redirect, "error");
    if (path.includes("debug_token"))
      return response({
        data: {
          app_id: "app",
          is_valid: true,
          scopes,
          expires_at: Date.now() / 1000 + 3600,
        },
      });
    return hook?.(path, init) || response({ id: "123" });
  }) as typeof fetch;
}
test("Facebook validates live token permissions and exact Page ownership before publishing text", async () => {
  let posted = 0;
  const connector = new FacebookConnector(
    meta,
    graph(["pages_manage_posts", "pages_read_engagement"], (url, init) => {
      if (url.endsWith("/feed")) {
        posted++;
        assert.deepEqual(JSON.parse(String(init?.body)), {
          message: input.text,
        });
        assert.equal(
          (init?.headers as Record<string, string>).Authorization,
          "Bearer private-token",
        );
        return response({ id: "123_456" });
      }
    }),
  );
  assert.equal((await connector.publish(input)).externalId, "123_456");
  assert.equal(posted, 1);
  await assert.rejects(
    () => connector.publish({ ...input, destination: "999" }),
    /ACCOUNT_OWNER_MISMATCH|Titular|capacidade/,
  );
  await assert.rejects(() =>
    new FacebookConnector(meta, graph([])).publish(input),
  );
  assert.equal(posted, 1);
});
test("mutating transport errors and invalid successful receipts remain uncertain", async () => {
  for (const failure of [
    () => {
      throw new Error("timeout");
    },
    () => response({}, 503),
    () => response({}),
  ]) {
    const connector = new FacebookConnector(
      meta,
      graph(["pages_manage_posts", "pages_read_engagement"], (url) =>
        url.endsWith("/feed") ? failure() : undefined,
      ),
    );
    await assert.rejects(
      () => connector.publish(input),
      (error: unknown) =>
        error instanceof ProviderFailure && error.kind === "uncertain",
    );
  }
});
test("Instagram uses one approved JPEG resolver URL and never takes arbitrary payload URLs", async () => {
  const calls: string[] = [];
  const fetcher = graph(
    ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
    (url, init) => {
      calls.push(url);
      if (url.includes("instagram_business_account"))
        return response({ instagram_business_account: { id: "456" } });
      if (url.endsWith("/media")) {
        assert.deepEqual(JSON.parse(String(init?.body)), {
          image_url:
            "https://media.example.org/approved.jpg?signature=temporary",
          caption: input.text,
        });
        return response({ id: "789" });
      }
      if (url.includes("status_code"))
        return response({ status_code: "FINISHED" });
      if (url.endsWith("/media_publish")) return response({ id: "900" });
    },
  );
  const resolve: MediaResolver = async (id) => {
    assert.equal(id, "asset-1");
    return {
      bytes: Buffer.from([255, 216, 255]),
      mime: "image/jpeg",
      publicUrl: "https://media.example.org/approved.jpg?signature=temporary",
    };
  };
  const publish = {
    ...input,
    destination: "456",
    payload: {
      mediaAssetIds: ["asset-1"],
      body: { image_url: "http://127.0.0.1/secret" },
    },
  };
  assert.equal(
    (await new InstagramConnector(meta, resolve, fetcher).publish(publish))
      .externalId,
    "900",
  );
  assert.equal(calls.filter((c) => c.endsWith("/media_publish")).length, 1);
  await assert.rejects(() =>
    new InstagramConnector(
      meta,
      async () => ({
        bytes: Buffer.from([255, 216]),
        mime: "image/jpeg",
        publicUrl: "https://127.0.0.1/secret",
      }),
      fetcher,
    ).publish(publish),
  );
  assert.equal(
    (
      await new InstagramConnector(meta, undefined, fetcher).health(
        input.token,
        "456",
      )
    ).publish,
    false,
  );
});
test("Instagram pending container does not publish or recreate a remote container", async () => {
  let publishCalls = 0;
  const connector = new InstagramConnector(
    meta,
    async () => ({
      bytes: Buffer.from([255, 216]),
      mime: "image/jpeg",
      publicUrl: "https://media.example.org/a.jpg",
    }),
    graph(
      ["instagram_basic", "instagram_content_publish", "pages_read_engagement"],
      (url) => {
        if (url.includes("instagram_business_account"))
          return response({ instagram_business_account: { id: "456" } });
        if (url.endsWith("/media")) return response({ id: "789" });
        if (url.includes("status_code"))
          return response({ status_code: "IN_PROGRESS" });
        if (url.endsWith("/media_publish")) publishCalls++;
      },
    ),
  );
  await assert.rejects(
    () =>
      connector.publish({
        ...input,
        destination: "456",
        payload: { mediaAssetIds: ["a"] },
      }),
    (e: unknown) =>
      e instanceof ProviderFailure &&
      e.kind === "uncertain" &&
      e.code === "INSTAGRAM_CONTAINER_PENDING",
  );
  assert.equal(publishCalls, 0);
});
test("YouTube uploads approved private MP4 bytes only to Google resumable session after scope and channel checks", async () => {
  const bytes = Buffer.from("0000ftyp0000");
  let uploaded = false;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("tokeninfo")) {
      assert.equal(init?.method, "POST");
      assert.equal(String(url).includes(input.token), false);
      return response({
        aud: "google-client",
        expires_in: "300",
        scope:
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      });
    }
    if (String(url).includes("channels?"))
      return response({ items: [{ id: "channel-1" }] });
    if (init?.method === "POST") {
      assert.deepEqual(JSON.parse(String(init.body)).status, {
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
      });
      return new Response(null, {
        status: 200,
        headers: {
          location:
            "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1",
        },
      });
    }
    assert.equal(
      String(url),
      "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=1",
    );
    assert.deepEqual(Buffer.from(init?.body as Uint8Array), bytes);
    uploaded = true;
    return response({ id: "video-1" });
  }) as typeof fetch;
  const connector = new YouTubeConnector(
    { client_id: "google-client" },
    async () => ({ bytes, mime: "video/mp4" }),
    fetcher,
  );
  const publish = {
    ...input,
    destination: "channel-1",
    payload: {
      title: "Approved title",
      mediaAssetIds: ["a"],
      body: { madeForKids: false },
    },
  };
  assert.equal((await connector.publish(publish)).externalId, "video-1");
  assert.equal(uploaded, true);
  await assert.rejects(() =>
    connector.publish({
      ...publish,
      payload: {
        ...publish.payload,
        body: { privacyStatus: "public", madeForKids: false },
      },
    }),
  );
  await assert.rejects(() =>
    connector.publish({ ...publish, destination: "other-channel" }),
  );
});
test("delegated CMS requires Audience ownership and matching idempotent remote receipt", async () => {
  const publish = {
    ...input,
    payload: {
      body: {
        audience_action_id: "action-1",
        audience_action_hash: `sha256:${"a".repeat(64)}`,
      },
    },
  };
  const config = {
    allowed_origins: '["https://audience.example.org"]',
    health_url: "https://audience.example.org/cms/health",
    publish_url: "https://audience.example.org/cms/execute",
  };
  let posted = 0;
  const connector = new DelegatedChannelConnector("cms", config, (async (
    _url: any,
    init?: RequestInit,
  ) => {
    if (init?.method === "POST") {
      posted++;
      assert.equal(
        (init.headers as Record<string, string>)["Idempotency-Key"],
        input.idempotencyKey,
      );
      return response({
        contractId: "dim.channel-transport.v1",
        idempotencyKey: input.idempotencyKey,
        destination: input.destination,
        status: "published",
        externalId: "blog-post-1",
        actionId: "action-1",
        actionHash: publish.payload.body.audience_action_hash,
      });
    }
    return response({
      contractId: "dim.channel-transport.v1",
      provider: "cms",
      destination: input.destination,
      readbackVerified: true,
      owner: "audience-builder",
      capabilities: ["publish_text"],
    });
  }) as typeof fetch);
  assert.equal((await connector.publish(publish)).externalId, "blog-post-1");
  assert.equal(posted, 1);
  await assert.rejects(() => connector.publish(input));
  await assert.rejects(() =>
    channelConnector(
      "cms",
      { ...config, publish_url: "https://127.0.0.1/internal" },
      undefined,
      (async () => response({})) as typeof fetch,
    ).publish(input),
  );
});
test("email gateway cannot enable send without a server consent resolver and verified sender", async () => {
  const config = {
    allowed_origins: '["https://email.example.org"]',
    health_url: "https://email.example.org/health",
    publish_url: "https://email.example.org/send",
  };
  let sent = 0;
  const fetcher = (async (_url: any, init?: RequestInit) => {
    if (init?.method === "POST") {
      sent++;
      assert.deepEqual(JSON.parse(String(init.body)).recipient, {
        email: "approved@example.org",
        consentReceiptId: "consent-1",
      });
      return response({
        contractId: "dim.channel-transport.v1",
        idempotencyKey: input.idempotencyKey,
        destination: input.destination,
        status: "published",
        externalId: "email-1",
      });
    }
    return response({
      contractId: "dim.channel-transport.v1",
      provider: "email",
      destination: input.destination,
      readbackVerified: true,
      senderVerified: true,
      capabilities: ["publish_text"],
    });
  }) as typeof fetch;
  assert.equal(
    (
      await channelConnector("email", config, undefined, fetcher).health(
        input.token,
        input.destination,
      )
    ).publish,
    false,
  );
  await assert.rejects(() =>
    channelConnector("email", config, undefined, fetcher).publish({
      ...input,
      payload: { subject: "Hi" },
    } as any),
  );
  assert.equal(sent, 0);
  const connector = new DelegatedChannelConnector(
    "email",
    config,
    fetcher,
    async (key) => {
      assert.equal(key, input.idempotencyKey);
      return { email: "approved@example.org", consentReceiptId: "consent-1" };
    },
  );
  assert.equal(
    (
      await connector.publish({
        ...input,
        payload: { subject: "Approved subject" },
      })
    ).externalId,
    "email-1",
  );
  assert.equal(sent, 1);
});
