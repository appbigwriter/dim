import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import {
  loadVerifiedMedia,
  sniffMime,
  uploadPrivate,
  type PrivateStorage,
} from "../packages/connectors/src/storage";
function mp4(size = 24) {
  const bytes = Buffer.alloc(size);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4);
  bytes.write("isom", 8);
  bytes.write("mp42", 16);
  return bytes;
}
test("private MP4 upload scans bytes before durable storage and reads matching approved bytes only", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: "VID",
      slug: "video",
      public_name: "Video",
      internal_name: "Video",
      type: "virtual",
    });
    const bytes = mp4(6 * 1024 * 1024);
    let scanned = false;
    let saved: Buffer | undefined;
    let objectPath = "";
    const storage: PrivateStorage = {
      upload: async (path, data, mime) => {
        assert.equal(scanned, true);
        assert.equal(mime, "video/mp4");
        saved = data;
        objectPath = path;
      },
      sign: async (path) => {
        assert.equal(path, objectPath);
        return "https://media.example.org/signed";
      },
      download: async (path, max) => {
        assert.equal(path, objectPath);
        assert.equal(max, 100 * 1024 * 1024);
        return saved!;
      },
    };
    const object = await scoped(f.db, f.actor, (tx) =>
      uploadPrivate(
        tx,
        f.actor,
        storage,
        async (data) => {
          assert.deepEqual(data, bytes);
          scanned = true;
        },
        {
          base64: bytes.toString("base64"),
          mime_type: "video/mp4",
          influencer_id: identity.id,
        },
      ),
    );
    const media = await scoped(f.db, f.actor, (tx) =>
      loadVerifiedMedia(tx, f.actor, object.id, storage),
    );
    assert.equal(media.mime, "video/mp4");
    assert.deepEqual(media.bytes, bytes);
    saved = Buffer.from(saved!);
    saved[20] = 123;
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          loadVerifiedMedia(tx, f.actor, object.id, storage),
        ),
      /Bytes da mídia/,
    );
    await assert.rejects(
      () =>
        scoped(f.db, f.actor, (tx) =>
          uploadPrivate(tx, f.actor, storage, async () => {}, {
            base64: "invalid!!",
            mime_type: "video/mp4",
            influencer_id: identity.id,
          }),
        ),
      /Base64/,
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        uploadPrivate(tx, f.actor, storage, async () => {}, {
          base64: bytes.toString("base64"),
          mime_type: "image/jpeg",
          influencer_id: identity.id,
        }),
      ),
    );
  } finally {
    await f.db.close();
  }
});
test("private media resolver rejects other tenants, unscanned objects and invalid path provenance before downloading", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: "MED",
      slug: "media",
      public_name: "Media",
      internal_name: "Media",
      type: "virtual",
    });
    const bytes = mp4();
    const object = await insert(f.db, "storage_objects", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      bucket: "dim-private",
      object_path: `${f.org.id}/${identity.id}/asset`,
      mime_type: "video/mp4",
      byte_size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      scan_status: "pending",
    });
    let downloads = 0;
    const storage: PrivateStorage = {
      upload: async () => {},
      sign: async () => "",
      download: async () => {
        downloads++;
        return bytes;
      },
    };
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        loadVerifiedMedia(tx, f.actor, object.id, storage),
      ),
    );
    await f.db.query(
      "UPDATE custom_dim.storage_objects SET scan_status='clean',object_path=$1 WHERE id=$2",
      ["another-tenant/asset", object.id],
    );
    await assert.rejects(() =>
      scoped(f.db, f.actor, (tx) =>
        loadVerifiedMedia(tx, f.actor, object.id, storage),
      ),
    );
    const otherActor = { ...f.actor, organizationId: randomUUID() };
    await assert.rejects(() =>
      loadVerifiedMedia(f.db, otherActor, object.id, storage),
    );
    assert.equal(downloads, 0);
    assert.equal(sniffMime(Buffer.from("0000ftyp0000")), undefined);
    assert.equal(sniffMime(mp4()), "video/mp4");
  } finally {
    await f.db.close();
  }
});
