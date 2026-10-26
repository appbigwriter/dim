import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { insert } from "../packages/db/src/index";
import { scoped } from "../packages/core/src/security";
import {
  identityPresentation,
  contentPresentation,
} from "../packages/core/src/presentation";
import { compareVersionText } from "../packages/contracts/src/version-comparison";
test("text comparison preserves every character with unicode, whitespace, insertions, removals and bounded long inputs", () => {
  for (const [previous, current] of [
    ["", ""],
    ["old", "new"],
    ["one two", "one"],
    ["one", "one two"],
    ["Olá 🪴\n  world", "Olá 🌎\n  world"],
    ["same", "same"],
    ["a ".repeat(20000), "a ".repeat(19999) + "b "],
  ]) {
    const diff = compareVersionText(previous, current);
    assert.equal(diff.prefix + diff.removed + diff.suffix, previous);
    assert.equal(diff.prefix + diff.added + diff.suffix, current);
    assert.equal(diff.changed, previous !== current);
  }
});
test("presentation respects identity scopes and tenant, media license/scan and cross-identity object ownership", async () => {
  const f = await fixture();
  try {
    const identity = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: randomUUID(),
      slug: randomUUID(),
      public_name: "Person",
      internal_name: "Person",
      type: "hybrid",
      owner_user_id: f.admin,
    });
    const other = await insert(f.db, "influencers", {
      organization_id: f.org.id,
      code: randomUUID(),
      slug: randomUUID(),
      public_name: "Other",
      internal_name: "Other",
      type: "virtual",
      owner_user_id: f.admin,
    });
    const party = await insert(f.db, "legal_parties", {
      organization_id: f.org.id,
      party_type: "person",
      display_name: "Holder",
    });
    const license = await insert(f.db, "media_licenses", {
      organization_id: f.org.id,
      license_type: "owned",
      holder_party_id: party.id,
      valid_until: "2099-01-01T00:00:00Z",
    });
    const expired = await insert(f.db, "media_licenses", {
      organization_id: f.org.id,
      license_type: "owned",
      holder_party_id: party.id,
      valid_until: "2020-01-01T00:00:00Z",
    });
    const create = async (
      ownerId: string,
      licenseId: string,
      scan = "clean",
    ) => {
      const object = await insert(f.db, "storage_objects", {
        organization_id: f.org.id,
        influencer_id: ownerId,
        bucket: "dim-private",
        object_path: `${f.org.id}/${ownerId}/${randomUUID()}`,
        mime_type: "image/png",
        byte_size: 12,
        sha256: "a".repeat(64),
        scan_status: scan,
        visibility: "private",
      });
      return insert(f.db, "identity_assets", {
        organization_id: f.org.id,
        influencer_id: identity.id,
        storage_object_id: object.id,
        license_id: licenseId,
        asset_type: "image",
      });
    };
    const clean = await create(identity.id, license.id);
    await create(identity.id, expired.id);
    await create(identity.id, license.id, "pending");
    await create(other.id, license.id);
    const view = await scoped(f.db, f.actor, (tx) =>
      identityPresentation(tx, f.actor, identity.id),
    );
    assert.equal(view.identity.type, "hybrid");
    assert.equal(view.assets.length, 4);
    assert.equal(
      view.assets.filter((asset: any) => asset.preview_allowed).length,
      1,
    );
    assert.equal(
      view.assets.find((asset: any) => asset.preview_allowed).asset_id,
      clean.id,
    );
    assert(!JSON.stringify(view).includes("object_path"));
    const readOnly = {
      ...f.actor,
      grants: [
        {
          permission: "identity.read",
          scopeType: "influencer",
          scopeId: identity.id,
        },
      ],
    };
    const restricted = await scoped(f.db, readOnly, (tx) =>
      identityPresentation(tx, readOnly, identity.id),
    );
    assert.equal(restricted.governance_visible, false);
    assert.equal(restricted.assets.length, 0);
    await assert.rejects(
      () =>
        scoped(f.db, readOnly, (tx) =>
          identityPresentation(tx, readOnly, other.id),
        ),
      /escopo/,
    );
    const alien = { ...f.actor, organizationId: f.other.id };
    await assert.rejects(
      () =>
        scoped(f.db, alien, (tx) =>
          identityPresentation(tx, alien, identity.id),
        ),
      /encontrado/,
    );
    const content = await insert(f.db, "content_items", {
      organization_id: f.org.id,
      influencer_id: identity.id,
      title: "Content",
      content_type: "caption",
      created_by: f.admin,
    });
    await insert(f.db, "content_versions", {
      organization_id: f.org.id,
      content_id: content.id,
      version_number: 1,
      language: "pt-BR",
      format: "caption",
      body_text: "Original",
      body: {
        asset_ids: [clean.storage_object_id],
        source_urls: ["https://source.example.org"],
      },
      payload_hash: "hash-1",
      created_by: f.admin,
    });
    await insert(f.db, "content_versions", {
      organization_id: f.org.id,
      content_id: content.id,
      version_number: 2,
      language: "en",
      format: "caption",
      body_text: "Updated",
      body: { asset_ids: [], source_urls: [] },
      payload_hash: "hash-2",
      created_by: f.admin,
    });
    const comparison = await scoped(f.db, f.actor, (tx) =>
      contentPresentation(tx, f.actor, content.id),
    );
    assert.equal(comparison.versions.length, 2);
    assert.equal(comparison.versions[0].language, "en");
    assert.deepEqual(comparison.versions[1].body.source_urls, [
      "https://source.example.org",
    ]);
    assert.equal(
      comparison.assets.filter((asset: any) => asset.preview_allowed).length,
      1,
    );
  } finally {
    await f.db.close();
  }
});
