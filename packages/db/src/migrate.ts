import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { postgres, type Database } from "./index";
export const migrationPath = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
export async function migrate(db: Database) {
  await db.query("CREATE SCHEMA IF NOT EXISTS custom_dim");
  await db.query(
    "CREATE TABLE IF NOT EXISTS custom_dim.schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz DEFAULT now())",
  );
  for (const name of readdirSync(migrationPath)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(migrationPath + name, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = (
      await db.query(
        "SELECT checksum FROM custom_dim.schema_migrations WHERE name=$1",
        [name],
      )
    ).rows[0];
    if (old) {
      if (old.checksum !== checksum)
        throw new Error(`Migration checksum changed: ${name}`);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.query(
        sql.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, ""),
      );
      await tx.query(
        "INSERT INTO custom_dim.schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
    });
    console.log(`Applied ${name}`);
  }
}
if (process.argv[1]?.endsWith("migrate.ts")) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const db = postgres(process.env.DATABASE_URL);
  try {
    await migrate(db);
  } finally {
    await db.close();
  }
}
