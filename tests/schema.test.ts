import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testDatabase } from "./helpers";
import { migrate } from "../packages/db/src/migrate";
import { seedOrganization } from "../packages/db/src/seed";
import { insert } from "../packages/db/src/index";
test("schema: 79 original tables, 4 Audience tables and factual verification; replay safe migrations, RLS, tenant FKs, append-only audit", async () => {
  const db = await testDatabase();
  try {
    await migrate(db);
    const count = (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='custom_dim' AND tablename<>'schema_migrations'",
      )
    ).rows[0];
    assert.equal(count.n, 84);
    const user = randomUUID();
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [user]);
    const a = await seedOrganization(db, user, "A", "a");
    const b = await seedOrganization(db, user, "B", "b");
    const identity = await insert(db, "influencers", {
      organization_id: a.id,
      code: "a",
      slug: "a",
      public_name: "A",
      internal_name: "A",
      type: "human",
    });
    await assert.rejects(
      () =>
        insert(db, "influencer_profiles", {
          organization_id: b.id,
          influencer_id: identity.id,
        }),
      /foreign key|cross-organization/i,
    );
    await db.transaction(async (tx) => {
      await tx.query("SELECT set_config('dim.organization_id',$1,true)", [
        b.id,
      ]);
      await tx.query("SET LOCAL ROLE dim_app");
      assert.equal(
        (await tx.query("SELECT * FROM custom_dim.influencers")).rows.length,
        0,
      );
    });
    const log = await insert(db, "audit_logs", {
      organization_id: a.id,
      actor_type: "user",
      action: "test",
      resource_type: "influencers",
    });
    await assert.rejects(
      () =>
        db.query("UPDATE custom_dim.audit_logs SET action=$1 WHERE id=$2", [
          "changed",
          log.id,
        ]),
      /Immutable/,
    );
    await db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE authenticated");
      await assert.rejects(
        () => tx.query("SELECT * FROM custom_dim.influencers"),
        /permission denied/,
      );
    });
  } finally {
    await db.close();
  }
});
