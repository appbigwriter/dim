import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { audienceFixture } from "./audience-fixture";
import {
  audienceContextHash,
  canonicalHash,
  validateAudienceContext,
} from "../packages/contracts/src/audience";
import { audienceProvider } from "../packages/connectors/src/audience";
import {
  bindAudience,
  syncAudience,
  audienceState,
  audienceBlockers,
} from "../packages/core/src/audience";
import { createResource } from "../packages/core/src/resources";
import { scoped } from "../packages/core/src/security";
import { persona, rightsBlockers } from "../packages/core/src/identity";
import { insert, one } from "../packages/db/src/index";
import {
  contentVersion,
  approve,
  schedule,
  verifyContent,
} from "../packages/core/src/editorial";
import { buildApp } from "../apps/api/src/app";
const mapping = {
  tenant_id: "audience-tenant-a",
  project_id: "audience-project-a",
  persona_id: "persona-a",
};
async function identity(f: Awaited<ReturnType<typeof fixture>>) {
  return scoped(f.db, f.actor, (tx) =>
    createResource(tx, f.actor, "influencers", {
      public_name: "Influenciador Audience",
      internal_name: "Audience",
      slug: `audience-${randomUUID()}`,
      type: "virtual",
      owner_user_id: f.admin,
    }),
  );
}
test("Audience context binds exact tenant, project, approved persona, hashes and non-test provenance", () => {
  const value = audienceFixture();
  assert.equal(
    validateAudienceContext(value, mapping).personaPackage.personaVersion,
    1,
  );
  assert.equal(canonicalHash({ b: 1, a: 2 }), canonicalHash({ a: 2, b: 1 }));
  assert.throws(
    () => validateAudienceContext(value, { ...mapping, tenant_id: "foreign" }),
    /outro tenant/,
  );
  const changed = structuredClone(value);
  changed.personaPackage.snapshot.characterBible.bio = "Adulterado";
  assert.throws(() => validateAudienceContext(changed, mapping), /Snapshot/);
  changed.personaPackage.contentHash = canonicalHash(
    changed.personaPackage.snapshot,
  );
  assert.throws(() => validateAudienceContext(changed, mapping), /Trajetória/);
  const withSecret = structuredClone(value);
  (withSecret.personaPackage.meta as any).access_token = "forbidden";
  assert.throws(
    () => validateAudienceContext(withSecret, mapping),
    /credenciais/,
  );
  const spaced = structuredClone(value);
  spaced.personaPackage.snapshot.characterBible.bio =
    "  Texto aprovado com espaços  ";
  spaced.personaPackage.contentHash = canonicalHash(
    spaced.personaPackage.snapshot,
  );
  spaced.contextHash = audienceContextHash(spaced);
  assert.equal(
    validateAudienceContext(spaced, mapping).personaPackage.snapshot
      .characterBible.bio,
    "  Texto aprovado com espaços  ",
  );
  const fixtureOnly = structuredClone(value);
  (fixtureOnly.personaPackage.meta as any).testOnly = true;
  assert.throws(
    () => validateAudienceContext(fixtureOnly, mapping),
    /aprovado e completo/,
  );
  const approval = structuredClone(value);
  approval.personaPackage.approval.approvedVersions = ["other-version"];
  approval.contextHash = audienceContextHash(approval);
  assert.throws(() => validateAudienceContext(approval, mapping), /não cobre/);
});
test("Audience HTTP adapter requires configured authorized scope and never follows redirects with credentials", async () => {
  let calls = 0;
  const validSecret = {
    token: "test-only-token",
    tenant_id: mapping.tenant_id,
    allowed_project_ids: JSON.stringify([mapping.project_id]),
    read_model_url: "https://audience.example.test/official-context",
  };
  const transport = (async (url: any, init: any) => {
    calls++;
    assert.equal(
      new URL(url).searchParams.get("project_id"),
      mapping.project_id,
    );
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer test-only-token");
    return Response.json(audienceFixture());
  }) as typeof fetch;
  const vault = { get: async () => validSecret, put: async () => {} };
  assert.equal(
    (await audienceProvider(vault, transport)("org", mapping)).projectId,
    mapping.project_id,
  );
  await assert.rejects(
    () =>
      audienceProvider(vault, transport)("org", {
        ...mapping,
        project_id: "forbidden",
      }),
    /não autorizado/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      audienceProvider(
        { get: async () => ({}), put: async () => {} },
        transport,
      )("org", mapping),
    /Configure/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      audienceProvider(
        {
          ...vault,
          get: async () => ({
            ...validSecret,
            read_model_url: "http://untrusted.example.test",
          }),
        },
        transport,
      )("org", mapping),
    /HTTPS/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      audienceProvider(vault, (async () => {
        throw new Error("do not leak test-only-token");
      }) as typeof fetch)("org", mapping),
    (error) => !(error as Error).message.includes("test-only-token"),
  );
});
test("Audience import is immutable/idempotent; bound personas cannot be edited locally and source failure blocks use", async () => {
  const f = await fixture();
  let app: any;
  try {
    const person = await identity(f);
    assert.equal(person.persona_source, "audience_builder");
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          persona(tx, f.actor, person.id, {
            public_bio: "Local",
            tone: {},
            traits: {},
            knowledge: {},
            boundaries: {},
            approval_status: "approved",
          }),
        ),
      /Audience Builder/,
    );
    assert(
      (
        await scoped(f.db, f.actor, (tx) => audienceBlockers(tx, person))
      ).includes("audience_binding_required"),
    );
    const bound = await scoped(f.db, f.actor, (tx) =>
      bindAudience(tx, f.actor, person.id, mapping),
    );
    assert.equal(
      (
        await scoped(f.db, f.actor, (tx) =>
          bindAudience(tx, f.actor, person.id, mapping),
        )
      ).id,
      bound.id,
    );
    await assert.rejects(() =>
      scoped(f.db, f.editActor, (tx) =>
        bindAudience(tx, f.editActor, person.id, mapping),
      ),
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          bindAudience(tx, f.actor, person.id, {
            ...mapping,
            project_id: "changed",
          }),
        ),
      /já vinculada/,
    );
    const first = await syncAudience(f.db, f.actor, person.id, async () =>
      audienceFixture(),
    );
    assert.equal(first.replay, false);
    assert.equal(
      (
        await syncAudience(f.db, f.actor, person.id, async () =>
          audienceFixture(),
        )
      ).replay,
      true,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.influencer_personas")).rows
        .length,
      1,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.audience_context_versions"))
        .rows.length,
      1,
    );
    await assert.rejects(
      () =>
        f.db.query(
          "UPDATE custom_dim.audience_context_versions SET context_hash='changed'",
        ),
      /Immutable/,
    );
    const read = await scoped(f.db, f.actor, (tx) =>
      audienceState(tx, f.actor, person.id),
    );
    assert.equal(read.current?.persona_version_id, "persona-a-v1");
    assert(!JSON.stringify(read).includes("characterBible"));
    await assert.rejects(() =>
      syncAudience(f.db, f.actor, person.id, async () => {
        throw new Error("provider unavailable");
      }),
    );
    assert(
      (
        await scoped(f.db, f.actor, (tx) => audienceBlockers(tx, person))
      ).includes("audience_context_not_verified"),
    );
    await syncAudience(f.db, f.actor, person.id, async () => audienceFixture());
    assert.deepEqual(
      await scoped(f.db, f.actor, (tx) => audienceBlockers(tx, person)),
      [],
    );
    await f.db.query(
      "UPDATE custom_dim.audience_bindings SET last_verified_at=now()-interval '25 hours'",
    );
    assert(
      (
        await scoped(f.db, f.actor, (tx) => audienceBlockers(tx, person))
      ).includes("audience_context_stale"),
    );
    app = await buildApp({
      db: f.db,
      authenticate: async () => f.actor,
      audience: async () => audienceFixture(),
    });
    const headers = {
      authorization: "Bearer fixture",
      "x-organization-id": f.org.id,
    };
    const profile = await app.inject({
      method: "POST",
      url: `/api/v1/influencers/${person.id}/profile`,
      headers,
      payload: {
        row_version: person.row_version,
        biography_short: "Não substituir",
        value_proposition: "Exemplo",
        audience: {},
        positioning: {},
        appearance_settings: {},
      },
    });
    assert.equal(profile.statusCode, 409);
    assert.equal(profile.json().code, "PROFILE_MANAGED_BY_AUDIENCE");

    assert.equal(
      (
        await app.inject({
          method: "GET",
          url: `/api/v1/influencers/${person.id}/audience/context`,
          headers,
        })
      ).statusCode,
      200,
    );
  } finally {
    await app?.close();
    await f.db.close();
  }
});
test("new Audience strategy cancels pending delivery and requires new content bound to the current context", async () => {
  const f = await fixture();
  try {
    const person = await identity(f);
    await scoped(f.db, f.actor, (tx) =>
      bindAudience(tx, f.actor, person.id, mapping),
    );
    await syncAudience(f.db, f.actor, person.id, async () => audienceFixture());
    await f.db.query(
      "UPDATE custom_dim.influencers SET status='active' WHERE id=$1",
      [person.id],
    );
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    const connector = await one(
      f.db,
      "SELECT id FROM custom_dim.connectors WHERE platform_id=$1",
      [platform.id],
    );
    await insert(f.db, "identity_disclosures", {
      organization_id: f.org.id,
      influencer_id: person.id,
      platform_id: platform.id,
      disclosure_type: "synthetic",
      disclosure_text: "Persona virtual",
    });
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: person.id,
      platform_id: platform.id,
      account_type: "channel",
      account_status: "active",
      integration_status: "connected",
      external_id: "-123",
    });
    await insert(f.db, "account_integrations", {
      organization_id: f.org.id,
      social_account_id: account.id,
      connector_id: connector.id,
      auth_type: "bot_token",
      status: "active",
      secret_ref: "fixture-ref",
      last_tested_at: new Date().toISOString(),
    });
    await insert(f.db, "account_capabilities", {
      organization_id: f.org.id,
      social_account_id: account.id,
      capability_code: "publish_text",
      available: true,
      checked_at: new Date().toISOString(),
    });
    await insert(f.db, "approval_policies", {
      organization_id: f.org.id,
      code: "editorial",
      version: 1,
      resource_type: "content",
    });
    const content = await scoped(f.db, f.editActor, (tx) =>
      createResource(tx, f.editActor, "contents", {
        influencer_id: person.id,
        title: "Plano de autoridade",
        objective: "Executar o plano aprovado",
        content_type: "text",
      }),
    );
    const input = {
      body_text: "Persona virtual. Conteúdo com fontes.",
      language: "pt-BR",
      format: "text",
      source_urls: ["https://source.example.test"],
    };
    const version = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, input),
    );
    assert(version.body.audience_context_id);
    await scoped(f.db, f.reviewActor, (tx) =>
      approve(tx, f.reviewActor, content.id, {
        content_version_id: version.id,
        decision: "approved",
        rationale: "Revisão local independente",
      }),
    );
    const job = await scoped(f.db, f.editActor, (tx) =>
      schedule(
        tx,
        f.editActor,
        {
          social_account_id: account.id,
          content_version_id: version.id,
          scheduled_at: new Date(Date.now() + 3600000).toISOString(),
        },
        randomUUID(),
      ),
    );
    const changed = audienceFixture();
    changed.contextVersion = 2;
    changed.authority.version = 2;
    changed.authority.objectives = ["Nova etapa de autoridade"];
    changed.contextHash = audienceContextHash(changed);
    await syncAudience(f.db, f.actor, person.id, async () => changed);
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.publication_jobs WHERE id=$1",
          [job.id],
        )
      ).status,
      "cancelled",
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.influencer_personas")).rows
        .length,
      1,
    );
    assert(
      (
        await scoped(f.db, f.editActor, (tx) =>
          verifyContent(tx, f.editActor, version.id),
        )
      ).flags.includes("audience_context_changed"),
    );
    const next = await scoped(f.db, f.editActor, (tx) =>
      contentVersion(tx, f.editActor, content.id, input),
    );
    assert.notEqual(
      next.body.audience_context_id,
      version.body.audience_context_id,
    );
    assert.notEqual(next.payload_hash, version.payload_hash);
    const personaChange = structuredClone(changed);
    personaChange.contextVersion = 3;
    personaChange.personaPackage.personaVersion = 2;
    personaChange.personaPackage.personaVersionId = "persona-a-v2";
    personaChange.personaPackage.approval.approvedVersions = ["persona-a-v2"];
    personaChange.personaPackage.snapshot.editorialProfile.voice =
      "Tom atualizado";
    personaChange.personaPackage.contentHash = canonicalHash(
      personaChange.personaPackage.snapshot,
    );
    personaChange.contextHash = audienceContextHash(personaChange);
    await syncAudience(f.db, f.actor, person.id, async () => personaChange);
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.influencer_personas")).rows
        .length,
      2,
    );
    await assert.rejects(
      () => syncAudience(f.db, f.actor, person.id, async () => changed),
      /anterior/,
    );
    assert(
      (
        await scoped(f.db, f.actor, (tx) => rightsBlockers(tx, f.actor, person))
      ).includes("audience_context_not_verified"),
    );
  } finally {
    await f.db.close();
  }
});
test("Audience tenant isolation applies in SQL and membership revoked during readback prevents import", async () => {
  const f = await fixture();
  try {
    const person = await identity(f);
    await scoped(f.db, f.actor, (tx) =>
      bindAudience(tx, f.actor, person.id, mapping),
    );
    await f.db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dim.organization_id',$1,true)", [
        f.other.id,
      ]);
      await tx.query("SET LOCAL ROLE dim_app");
      assert.equal(
        (await tx.query("SELECT * FROM custom_dim.audience_bindings")).rows
          .length,
        0,
      );
    });
    await assert.rejects(
      () =>
        syncAudience(f.db, f.actor, person.id, async () => {
          const wrong = audienceFixture();
          wrong.tenantId = "other-tenant";
          wrong.contextHash = audienceContextHash(wrong);
          return wrong;
        }),
      /outro tenant/,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.audience_context_versions"))
        .rows.length,
      0,
    );
    await assert.rejects(
      () =>
        syncAudience(f.db, f.actor, person.id, async () => {
          await f.db.query(
            "UPDATE custom_dim.organization_members SET status='revoked' WHERE organization_id=$1 AND user_id=$2",
            [f.org.id, f.admin],
          );
          return audienceFixture();
        }),
      /Organização indisponível/,
    );
    assert.equal(
      (await f.db.query("SELECT * FROM custom_dim.audience_context_versions"))
        .rows.length,
      0,
    );
  } finally {
    await f.db.close();
  }
});
