import type { Actor } from "../../contracts/src/index";
import { one, type DB } from "../../db/src/index";
import { authorize, resource, visible } from "./security";

async function mediaMetadata(db: DB, actor: Actor, influencerId: string) {
  authorize(actor, "governance.read", { influencerId });
  const rows = (
    await db.query(
      `SELECT a.id AS asset_id,a.asset_type,a.approval_status,a.created_at,
    s.id AS storage_object_id,s.influencer_id,s.mime_type,s.byte_size,s.sha256,s.scan_status,s.visibility,s.bucket,s.object_path,
    l.id AS license_id,l.license_type,l.valid_until,
    (l.id IS NOT NULL AND l.valid_until>now()) AS license_valid
    FROM custom_dim.identity_assets a JOIN custom_dim.storage_objects s ON s.id=a.storage_object_id AND s.organization_id=a.organization_id
    LEFT JOIN custom_dim.media_licenses l ON l.id=a.license_id AND l.organization_id=a.organization_id
    WHERE a.organization_id=$1 AND a.influencer_id=$2 ORDER BY a.created_at DESC,a.id LIMIT 200`,
      [actor.organizationId, influencerId],
    )
  ).rows;
  return rows.map(({ object_path, bucket, ...row }) => {
    const verified =
      bucket === "dim-private" &&
      typeof object_path === "string" &&
      object_path.startsWith(`${actor.organizationId}/${influencerId}/`) &&
      !object_path.includes("..") &&
      /^[a-f0-9]{64}$/.test(row.sha256 || "") &&
      Number(row.byte_size) > 0;
    return {
      ...row,
      preview_allowed:
        verified &&
        row.scan_status === "clean" &&
        row.visibility === "private" &&
        row.influencer_id === influencerId &&
        row.license_valid === true,
      preview_blockers: [
        ...(!verified
          ? ["Metadados privados ou checksum nao verificados"]
          : []),
        ...(row.scan_status !== "clean"
          ? ["Antivirus pendente ou arquivo rejeitado"]
          : []),
        ...(row.visibility !== "private" ? ["Arquivo deve ser privado"] : []),
        ...(!row.license_valid ? ["Licenca ausente ou vencida"] : []),
        ...(row.influencer_id !== influencerId
          ? ["Arquivo pertence a outra identidade"]
          : []),
      ],
    };
  });
}
export async function identityPresentation(db: DB, actor: Actor, id: string) {
  const identity = await resource(db, "influencers", id, actor);
  authorize(actor, "identity.read", { influencerId: id });
  const team = (
    await db.query(
      "SELECT m.user_id,p.display_name FROM custom_dim.organization_members m LEFT JOIN custom_dim.user_profiles p ON p.user_id=m.user_id WHERE m.organization_id=$1 AND m.status='active'",
      [actor.organizationId],
    )
  ).rows;
  const governance = visible(actor, "governance.read", { influencer_id: id });
  if (!governance)
    return {
      identity,
      team,
      governance_visible: false,
      profile: null,
      persona: null,
      contracts: [],
      consents: [],
      assets: [],
    };
  const profile = await one(
    db,
    "SELECT biography_short,biography_long,value_proposition,audience,positioning,appearance_settings FROM custom_dim.influencer_profiles WHERE organization_id=$1 AND influencer_id=$2",
    [actor.organizationId, id],
  );
  const persona = await one(
    db,
    "SELECT version,public_bio,tone,traits,knowledge,boundaries,source_system,source_version_id FROM custom_dim.influencer_personas WHERE organization_id=$1 AND influencer_id=$2 ORDER BY version DESC LIMIT 1",
    [actor.organizationId, id],
  );
  const audience = await one(
    db,
    "SELECT c.context->'personaPackage'->'snapshot' AS snapshot FROM custom_dim.audience_bindings b JOIN custom_dim.audience_context_versions c ON c.id=b.current_context_id WHERE b.organization_id=$1 AND b.influencer_id=$2",
    [actor.organizationId, id],
  );
  const contracts = (
    await db.query(
      "SELECT c.id,c.contract_type,c.version,c.status,c.starts_at,c.ends_at,p.display_name AS owner_name FROM custom_dim.influencer_contracts c LEFT JOIN custom_dim.legal_parties p ON p.id=c.owner_party_id AND p.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.influencer_id=$2 ORDER BY c.created_at DESC LIMIT 50",
      [actor.organizationId, id],
    )
  ).rows;
  const consents = (
    await db.query(
      "SELECT c.id,c.use_type,c.granted_at,c.expires_at,c.revoked_at,p.display_name AS subject_name FROM custom_dim.identity_consents c JOIN custom_dim.legal_parties p ON p.id=c.subject_party_id AND p.organization_id=c.organization_id WHERE c.organization_id=$1 AND c.influencer_id=$2 AND NOT EXISTS(SELECT 1 FROM custom_dim.identity_consents n WHERE n.supersedes_id=c.id) ORDER BY c.created_at DESC LIMIT 100",
      [actor.organizationId, id],
    )
  ).rows;
  return {
    identity,
    team,
    governance_visible: true,
    profile: profile || null,
    persona: persona || null,
    audience_snapshot: audience?.snapshot || null,
    contracts,
    consents,
    assets: await mediaMetadata(db, actor, id),
  };
}
export async function contentPresentation(db: DB, actor: Actor, id: string) {
  const content = await resource(db, "content_items", id, actor);
  authorize(actor, "editorial.read", { influencerId: content.influencer_id });
  const versions = (
    await db.query(
      "SELECT id,version_number,language,format,body_text,body,payload_hash,created_at FROM custom_dim.content_versions WHERE organization_id=$1 AND content_id=$2 ORDER BY version_number DESC LIMIT 30",
      [actor.organizationId, id],
    )
  ).rows;
  const governance = visible(actor, "governance.read", {
    influencer_id: content.influencer_id,
  });
  return {
    content,
    versions,
    media_visible: governance,
    assets: governance
      ? await mediaMetadata(db, actor, content.influencer_id)
      : [],
  };
}
