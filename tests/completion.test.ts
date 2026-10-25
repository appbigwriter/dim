import { identityChannels } from "../packages/core/src/channels";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert, one } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import { createResource } from "../packages/core/src/resources";
import {
  saveOnboarding,
  activationBlockers,
} from "../packages/core/src/identity";
import {
  completeOnboardingStep,
  finishOnboarding,
  mergeContacts,
  exportContact,
  conversationPreferences,
  saveInboxPolicy,
} from "../packages/core/src/completion";
import {
  inviteMember,
  acceptInvitation,
} from "../packages/core/src/invitations";
import { loadActor } from "../packages/core/src/access";
import { buildApp } from "../apps/api/src/app";
import {
  calendarDays,
  wallTimeToUtc,
} from "../packages/contracts/src/calendar";
import {
  fetchWhatsappTemplates,
  templateParameters,
} from "../packages/connectors/src/templates";
test("calendar navigates across months and rejects DST gaps/ambiguous times unless explicitly chosen", () => {
  assert.deepEqual(calendarDays("2026-11-01", "week"), [
    "2026-10-26",
    "2026-10-27",
    "2026-10-28",
    "2026-10-29",
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
  ]);
  assert.equal(calendarDays("2024-02-15", "month").length, 42);
  assert.equal(
    wallTimeToUtc("2026-10-25T12:30", "America/Sao_Paulo"),
    "2026-10-25T15:30:00.000Z",
  );
  assert.throws(
    () => wallTimeToUtc("2026-03-08T02:30", "America/New_York"),
    /inexistente/,
  );
  assert.throws(
    () => wallTimeToUtc("2026-11-01T01:30", "America/New_York"),
    /ambíguo/,
  );
  assert.equal(
    wallTimeToUtc("2026-11-01T01:30", "America/New_York", "earlier"),
    "2026-11-01T05:30:00.000Z",
  );
  assert.equal(
    wallTimeToUtc("2026-11-01T01:30", "America/New_York", "later"),
    "2026-11-01T06:30:00.000Z",
  );
  assert.throws(() => wallTimeToUtc("2026-02-30T10:00", "UTC"), /inválida/);
});
test("template pagination keeps credentials on the official origin, detects loops and validates ordered variables", async () => {
  const urls: string[] = [];
  const request = (async (url: any) => {
    urls.push(String(url));
    return Response.json(
      urls.length === 1
        ? {
            data: [{ id: "1" }],
            paging: {
              next: "https://evil.invalid/steal",
              cursors: { after: "opaque&cursor" },
            },
          }
        : { data: [{ id: "2" }] },
    );
  }) as typeof fetch;
  assert.equal(
    (await fetchWhatsappTemplates("secret", "123", "v25.0", request)).length,
    2,
  );
  assert(urls.every((u) => new URL(u).origin === "https://graph.facebook.com"));
  assert.equal(new URL(urls[1]).searchParams.get("after"), "opaque&cursor");
  await assert.rejects(
    () =>
      fetchWhatsappTemplates("secret", "123", "v25.0", (async () =>
        Response.json({
          data: [],
          paging: { next: "ignored", cursors: { after: "loop" } },
        })) as typeof fetch),
    /Paginação/,
  );
  const template = {
    content: {
      components: [{ type: "BODY", text: "Olá {{1}}, pedido {{2}}." }],
    },
  };
  assert.throws(() => templateParameters(template, ["Maria"]), /2 parâmetros/);
  assert.equal(
    templateParameters(template, ["Maria", "123"])?.[0].parameters.length,
    2,
  );
});
test("onboarding cannot bypass validated steps, requires clean identity evidence, and preserves completed autosave", async () => {
  const f = await fixture();
  try {
    const identity = await scoped(f.db, f.actor, (tx) =>
      createResource(tx, f.actor, "influencers", {
        public_name: "Cadastro",
        internal_name: "Cadastro",
        slug: "cadastro",
        type: "virtual",
        owner_user_id: f.admin,
      }),
    );
    const coverage = await scoped(f.db, f.actor, (tx) =>
      identityChannels(tx, f.actor, identity.id),
    );
    assert.equal(coverage.data.length, 9);
    assert(
      coverage.data.some(
        (c) => c.code === "youtube" && c.implementation === "catalog_only",
      ),
    );
    assert(coverage.data.every((c) => !c.connected_record));
    assert(
      await one(
        f.db,
        "SELECT id FROM custom_dim.platforms WHERE code='youtube'",
      ),
    );
    const session = await one(
      f.db,
      "SELECT id FROM custom_dim.onboarding_sessions WHERE influencer_id=$1",
      [identity.id],
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        saveOnboarding(tx, f.actor, session.id, {
          step_code: "tests",
          status: "completed",
          data: {},
        }),
      ),
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          completeOnboardingStep(tx, f.actor, session.id, "tests"),
        ),
      /evidência/,
    );
    await scoped(f.db, f.actor, (tx) =>
      completeOnboardingStep(tx, f.actor, session.id, "identity"),
    );
    await scoped(f.db, f.actor, (tx) =>
      saveOnboarding(tx, f.actor, session.id, {
        step_code: "identity",
        status: "in_progress",
        data: {},
      }),
    );
    assert.equal(
      (
        await one(
          f.db,
          "SELECT status FROM custom_dim.onboarding_steps WHERE session_id=$1 AND step_code='identity'",
          [session.id],
        )
      ).status,
      "completed",
    );
    const evidence = await insert(f.db, "storage_objects", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      bucket: "dim-private",
      object_path: `${f.org.id}/${randomUUID()}`,
      scan_status: "clean",
    });
    await scoped(f.db, f.actor, (tx) =>
      saveOnboarding(tx, f.actor, session.id, {
        step_code: "tests",
        status: "in_progress",
        data: { evidence_object_id: evidence.id },
      }),
    );
    await scoped(f.db, f.actor, (tx) =>
      completeOnboardingStep(tx, f.actor, session.id, "tests"),
    );
    const blockers = await scoped(f.db, f.actor, (tx) =>
      activationBlockers(tx, f.actor, identity),
    );
    assert(blockers.includes("onboarding_steps_incomplete"));
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          finishOnboarding(tx, f.actor, session.id, {
            confirmed: true,
            reason: "Validar",
          }),
        ),
      /ACTIVATION|approved_persona/,
    );
  } finally {
    await f.db.close();
  }
});
test("invitations require verified recipient, preserve idempotency, and session revocation is audited", async () => {
  const f = await fixture();
  let app: any;
  try {
    const userId = randomUUID();
    await f.db.query("INSERT INTO auth.users(id) VALUES($1)", [userId]);
    const role = await one(
      f.db,
      "SELECT id FROM custom_dim.roles WHERE organization_id=$1 AND code='support'",
      [f.org.id],
    );
    let sent = 0;
    const invite = async () => {
      sent++;
      return { userId };
    };
    const input = { email: "support@example.test", role_id: role.id };
    const result = await inviteMember(
      f.db,
      f.actor,
      invite,
      input,
      "invitation-test-key",
    );
    await inviteMember(f.db, f.actor, invite, input, "invitation-test-key");
    assert.equal(sent, 1);
    await assert.rejects(() =>
      loadActor(f.db, userId, f.org.id, "aal1", randomUUID()),
    );
    await assert.rejects(() =>
      acceptInvitation(f.db, result.id, { userId, emailVerified: false }),
    );
    await assert.rejects(() =>
      acceptInvitation(f.db, result.id, {
        userId: f.editor,
        emailVerified: true,
      }),
    );
    assert.equal(
      (await acceptInvitation(f.db, result.id, { userId, emailVerified: true }))
        .accepted,
      true,
    );
    assert(
      (await loadActor(f.db, userId, f.org.id, "aal1", randomUUID())).grants
        .length > 0,
    );
    const sessionId = randomUUID();
    await f.db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      sessionId,
      userId,
    ]);
    app = await buildApp({ db: f.db, authenticate: async () => f.actor });
    const headers = {
      authorization: "Bearer test",
      "x-organization-id": f.org.id,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/security/sessions/${sessionId}/revoke`,
          headers,
          payload: {},
        })
      ).statusCode,
      200,
    );
    assert(
      await one(
        f.db,
        "SELECT id FROM custom_dim.organization_settings WHERE module_key=$1",
        [`revoked_session:${sessionId}`],
      ),
    );
    const cross = randomUUID();
    await f.db.query("INSERT INTO auth.users(id) VALUES($1)", [cross]);
    const foreignSession = randomUUID();
    await f.db.query("INSERT INTO auth.sessions(id,user_id) VALUES($1,$2)", [
      foreignSession,
      cross,
    ]);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/security/sessions/${foreignSession}/revoke`,
          headers,
          payload: {},
        })
      ).statusCode,
      404,
    );
  } finally {
    await app?.close();
    await f.db.close();
  }
});
test("manual contact linking preserves consent ownership and cross-tenant requests fail", async () => {
  const f = await fixture();
  try {
    const source = await insert(f.db, "contacts", {
        organization_id: f.org.id,
        display_name: "Origem",
      }),
      target = await insert(f.db, "contacts", {
        organization_id: f.org.id,
        display_name: "Destino",
      }),
      foreign = await insert(f.db, "contacts", { organization_id: f.other.id });
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        mergeContacts(tx, f.actor, source.id, foreign.id, "Revisão"),
      ),
    );
    await scoped(f.db, f.actor, (tx) =>
      mergeContacts(tx, f.actor, source.id, target.id, "Duplicado confirmado"),
    );
    const exported = await scoped(f.db, f.actor, (tx) =>
      exportContact(tx, f.actor, source.id),
    );
    assert.equal(exported.contact.merged_into_id, target.id);
    assert.equal(exported.messages.length, 0);
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        mergeContacts(tx, f.actor, target.id, source.id, "Ciclo"),
      ),
    );
    await saveInboxPolicy(f.db, f.actor, {
      sla_hours: 4,
      retention_days: 90,
      whatsapp_window_hours: 12,
    });
    assert.equal(
      (
        await one(
          f.db,
          "SELECT settings FROM custom_dim.organization_settings WHERE module_key='inbox' AND organization_id=$1",
          [f.org.id],
        )
      ).settings.sla_hours,
      4,
    );
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      public_name: "Chat",
      internal_name: "Chat",
      slug: "chat",
      code: "CHAT",
      type: "virtual",
    });
    const platform = await one(
      f.db,
      "SELECT id FROM custom_dim.platforms WHERE code='telegram'",
    );
    const account = await insert(f.db, "social_accounts", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      platform_id: platform.id,
      account_type: "bot",
    });
    const c = await insert(f.db, "conversations", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      social_account_id: account.id,
      contact_id: target.id,
      unread_count: 2,
    });
    await scoped(f.db, f.actor, (tx) =>
      conversationPreferences(tx, f.actor, c.id, {
        tags: ["urgente", "urgente"],
        mark_read: true,
      }),
    );
    const updated = await one(
      f.db,
      "SELECT * FROM custom_dim.conversations WHERE id=$1",
      [c.id],
    );
    assert.equal(updated.unread_count, 0);
    assert.deepEqual(updated.tags, ["urgente"]);
  } finally {
    await f.db.close();
  }
});
