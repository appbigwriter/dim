import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { writeFileSync } from "node:fs";
import {
  mkdtemp,
  writeFile,
  readFile,
  copyFile,
  unlink,
  rmdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fixture } from "./helpers";
import { insert } from "../packages/db/src/index";
test("isolated recovery restores database and separate media bytes with matching checksum", async () => {
  const f = await fixture(),
    root = await mkdtemp(join(tmpdir(), "dim-recovery-"));
  let restored: PGlite | undefined;
  const paths = ["media.bin", "backup.bin", "restored.bin"].map((n) =>
    join(root, n),
  );
  try {
    const bytes = Buffer.from("DIM private test media"),
      sha = createHash("sha256").update(bytes).digest("hex");
    await writeFile(paths[0], bytes);
    await copyFile(paths[0], paths[1]);
    const file = await insert(f.db, "storage_objects", {
      organization_id: f.org.id,
      bucket: "dim-private",
      object_path: `${f.org.id}/restore-fixture`,
      sha256: sha,
      scan_status: "clean",
    });
    const snapshot = await f.db.snapshot();
    const start = performance.now();
    restored = new PGlite({ loadDataDir: snapshot });
    const row = (
      await restored.query<any>(
        "SELECT * FROM custom_dim.storage_objects WHERE id=$1",
        [file.id],
      )
    ).rows[0];
    await copyFile(paths[1], paths[2]);
    const restoredBytes = await readFile(paths[2]);
    assert.equal(
      createHash("sha256").update(restoredBytes).digest("hex"),
      row.sha256,
    );
    assert.equal(row.organization_id, f.org.id);
    writeFileSync(
      "docs/recovery-report.json",
      JSON.stringify(
        {
          executed_at: new Date().toISOString(),
          environment:
            "Local isolated PGlite snapshot + separate file copy; not Supabase/VPS or remote backup verification",
          database_restored: true,
          media_restored: true,
          checksum_verified: true,
          recovery_ms: +(performance.now() - start).toFixed(2),
          production_rpo_rto:
            "Not measured; requires staging and remote backup credentials",
        },
        null,
        2,
      ),
    );
  } finally {
    await restored?.close();
    await f.db.close();
    for (const path of paths) await unlink(path).catch(() => {});
    await rmdir(root);
  }
});
