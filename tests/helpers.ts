import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { migrate } from "../packages/db/src/migrate";
import {
  seedCatalog,
  seedOrganization,
  assignRole,
} from "../packages/db/src/seed";
import { insert, type Database, type DB } from "../packages/db/src/index";
import { loadActor } from "../packages/core/src/access";
export async function testDatabase() {
  const pg = new PGlite();
  await pg.exec(
    "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  const wrap = (q: any): DB => ({
    query: async (sql, values) => {
      const sanitized = sql.replace(
        "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
        "",
      );
      if (
        !values?.length &&
        /;[\s\S]*\S/.test(sanitized.trim().replace(/;$/, ""))
      ) {
        await q.exec(sanitized);
        return { rows: [] };
      }
      return q.query(sanitized, values);
    },
  });
  const db: Database = {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
  await migrate(db);
  await seedCatalog(db);
  return Object.assign(db, { snapshot: () => pg.dumpDataDir() });
}
export async function fixture() {
  const db = await testDatabase();
  const admin = randomUUID(),
    editor = randomUUID(),
    reviewer = randomUUID();
  for (const id of [admin, editor, reviewer])
    await db.query("INSERT INTO auth.users(id) VALUES($1)", [id]);
  const org = await seedOrganization(
    db,
    admin,
    "Organização A",
    `org-${randomUUID()}`,
  );
  const other = await seedOrganization(
    db,
    admin,
    "Organização B",
    `org-${randomUUID()}`,
  );
  for (const userId of [editor, reviewer])
    await insert(db, "organization_members", {
      organization_id: org.id,
      user_id: userId,
      status: "active",
    });
  await assignRole(db, org.id, editor, "editor");
  await assignRole(db, org.id, reviewer, "reviewer");
  const actor = await loadActor(db, admin, org.id, "aal2", randomUUID());
  const editActor = await loadActor(db, editor, org.id, "aal1", randomUUID());
  const reviewActor = await loadActor(
    db,
    reviewer,
    org.id,
    "aal1",
    randomUUID(),
  );
  return {
    db,
    admin,
    editor,
    reviewer,
    org,
    other,
    actor,
    editActor,
    reviewActor,
  };
}
