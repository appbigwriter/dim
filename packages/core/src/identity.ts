import { z } from "zod";
import {
  demand,
  identityInput,
  transitionInput,
  json,
  text,
  uuid,
  type Actor,
} from "../../contracts/src/index";
import { insert, one, type DB } from "../../db/src/index";
import { audit, authorize, event, member, resource } from "./security";
const transitions: Record<string, string[]> = {
  draft: ["under_review", "offboarding"],
  under_review: ["approved", "changes_required", "offboarding"],
  changes_required: ["under_review", "offboarding"],
  approved: ["provisioning", "offboarding"],
  provisioning: ["ready", "offboarding"],
  ready: ["active", "offboarding"],
  active: ["paused", "restricted", "offboarding"],
  paused: ["active", "offboarding"],
  restricted: ["under_review", "offboarding"],
  offboarding: ["archived"],
  archived: [],
};
export async function rightsBlockers(
  db: DB,
  actor: Actor,
  identity: any,
  platform?: string,
) {
  const values = [actor.organizationId, identity.id];
  const blockers: string[] = [];
  if (!identity.owner_user_id) blockers.push("responsible_owner");
  else if (
    !(await one(
      db,
      "SELECT 1 FROM custom_dim.organization_members WHERE organization_id=$1 AND user_id=$2 AND status='active'",
      [actor.organizationId, identity.owner_user_id],
    ))
  )
    blockers.push("active_owner_membership");
  if (identity.type !== "virtual") {
    if (
      !(await one(
        db,
        "SELECT id FROM custom_dim.influencer_contracts WHERE organization_id=$1 AND influencer_id=$2 AND status='signed' AND starts_at<=now() AND ends_at>now() AND owner_party_id IS NOT NULL AND storage_object_id IS NOT NULL",
        values,
      ))
    )
      blockers.push("signed_contract");
    for (const use of identity.type === "hybrid"
      ? ["image", "voice", "synthetic_image", "synthetic_voice"]
      : ["image", "voice"]) {
      if (
        !(await one(
          db,
          `SELECT id FROM custom_dim.identity_consents c WHERE organization_id=$1 AND influencer_id=$2 AND use_type=$3 AND revoked_at IS NULL AND granted_at<=now() AND (expires_at IS NULL OR expires_at>now()) AND NOT EXISTS(SELECT 1 FROM custom_dim.identity_consents r WHERE r.supersedes_id=c.id)${platform ? " AND (scope->'platforms' @> jsonb_build_array($4::text) OR scope->'platforms' @> '[\"*\"]'::jsonb)" : ""}`,
          [...values, use, ...(platform ? [platform] : [])],
        ))
      )
        blockers.push(`consent_${use}`);
    }
  }
  if (identity.type !== "human") {
    if (
      !(await one(
        db,
        "SELECT id FROM custom_dim.influencer_personas WHERE organization_id=$1 AND influencer_id=$2 AND approval_status='approved'",
        values,
      ))
    )
      blockers.push("approved_persona");
    if (
      !(await one(
        db,
        "SELECT id FROM custom_dim.identity_disclosures WHERE organization_id=$1 AND influencer_id=$2 AND enabled=true AND disclosure_type='synthetic'",
        values,
      ))
    )
      blockers.push("synthetic_disclosure");
  }
  const invalid = await one(
    db,
    `SELECT a.id FROM custom_dim.identity_assets a LEFT JOIN custom_dim.media_licenses l ON l.id=a.license_id WHERE a.organization_id=$1 AND a.influencer_id=$2 AND (l.id IS NULL OR l.valid_until<=now())`,
    values,
  );
  if (invalid) blockers.push("media_license");
  return blockers;
}
export async function activationBlockers(db: DB, actor: Actor, identity: any) {
  const blockers = await rightsBlockers(db, actor, identity);
  const values = [actor.organizationId, identity.id];
  if (
    !(await one(
      db,
      "SELECT 1 FROM custom_dim.influencer_assignments a JOIN custom_dim.organization_members m ON m.organization_id=a.organization_id AND m.user_id=a.user_id AND m.status='active' WHERE a.organization_id=$1 AND a.influencer_id=$2 AND a.responsibility='editor' AND (a.ends_at IS NULL OR a.ends_at>now())",
      values,
    ))
  )
    blockers.push("editor");
  if (
    !(await one(
      db,
      `SELECT a.id FROM custom_dim.social_accounts a JOIN custom_dim.account_integrations i ON i.social_account_id=a.id WHERE a.organization_id=$1 AND a.influencer_id=$2 AND a.account_status='active' AND a.integration_status='connected' AND i.status='active' AND i.last_tested_at>now()-interval '24 hours' AND (i.expires_at IS NULL OR i.expires_at>now())`,
      values,
    ))
  )
    blockers.push("operational_channel");
  if (
    !(await one(
      db,
      "SELECT 1 FROM custom_dim.approval_policies WHERE organization_id=$1 AND enabled=true AND resource_type='content'",
      [actor.organizationId],
    ))
  )
    blockers.push("editorial_policy");
  if (
    await one(
      db,
      "SELECT 1 FROM custom_dim.security_incidents WHERE organization_id=$1 AND severity='critical' AND state<>'resolved'",
      [actor.organizationId],
    )
  )
    blockers.push("critical_incident");
  if (
    !(await one(
      db,
      `SELECT 1 FROM (SELECT a.decision FROM custom_dim.onboarding_approvals a JOIN custom_dim.onboarding_sessions s ON s.id=a.session_id WHERE s.organization_id=$1 AND s.influencer_id=$2 ORDER BY a.decided_at DESC NULLS LAST,a.created_at DESC LIMIT 1) latest WHERE decision='approved'`,
      values,
    ))
  )
    blockers.push("onboarding_approval");
  if (
    await one(
      db,
      "SELECT 1 FROM custom_dim.onboarding_tasks t JOIN custom_dim.onboarding_sessions s ON s.id=t.session_id WHERE s.organization_id=$1 AND s.influencer_id=$2 AND t.status<>'completed'",
      values,
    )
  )
    blockers.push("pending_onboarding_tasks");
  if (
    await one(
      db,
      "SELECT 1 FROM custom_dim.account_provisioning_tasks t JOIN custom_dim.social_accounts a ON a.id=t.social_account_id WHERE a.organization_id=$1 AND a.influencer_id=$2 AND t.status<>'completed'",
      values,
    )
  )
    blockers.push("pending_account_tasks");
  if (
    await one(
      db,
      "SELECT 1 FROM custom_dim.onboarding_steps t JOIN custom_dim.onboarding_sessions s ON s.id=t.session_id WHERE s.organization_id=$1 AND s.influencer_id=$2 AND t.step_code<>'activation' AND t.status<>'completed'",
      values,
    )
  )
    blockers.push("onboarding_steps_incomplete");
  return blockers;
}
export async function transition(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const command = transitionInput.parse(input);
  const identity = await resource(db, "influencers", id, actor);
  authorize(actor, "identity.write", { influencerId: id });
  demand(
    identity.row_version === command.row_version,
    "VERSION_CONFLICT",
    "O cadastro foi alterado por outra pessoa",
    409,
  );
  demand(
    transitions[identity.status]?.includes(command.status),
    "INVALID_TRANSITION",
    "Transição não permitida",
  );
  if (["approved", "ready", "active"].includes(command.status)) {
    const blockers =
      command.status === "active"
        ? await activationBlockers(db, actor, identity)
        : await rightsBlockers(db, actor, identity);
    demand(!blockers.length, "ACTIVATION_BLOCKED", blockers.join(", "));
  }
  const row = await one(
    db,
    "UPDATE custom_dim.influencers SET status=$1,row_version=row_version+1 WHERE id=$2 AND organization_id=$3 AND row_version=$4 RETURNING *",
    [command.status, id, actor.organizationId, command.row_version],
  );
  demand(row, "VERSION_CONFLICT", "Atualização concorrente", 409);
  await insert(db, "influencer_status_history", {
    organization_id: actor.organizationId,
    influencer_id: id,
    old_status: identity.status,
    new_status: command.status,
    reason: command.reason,
    changed_by: actor.userId,
  });
  if (
    ["paused", "restricted", "offboarding", "archived"].includes(command.status)
  ) {
    await db.query(
      "UPDATE custom_dim.publication_jobs SET status='cancelled',last_error='IDENTITY_SUSPENDED' WHERE organization_id=$1 AND social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$2) AND status IN('queued','retry','publishing')",
      [actor.organizationId, id],
    );
    await db.query(
      "UPDATE custom_dim.agent_assignments SET enabled=false WHERE organization_id=$1 AND influencer_id=$2",
      [actor.organizationId, id],
    );
    await db.query(
      "UPDATE custom_dim.operation_jobs SET status='cancelled',last_error='IDENTITY_SUSPENDED' WHERE organization_id=$1 AND status IN('queued','retry') AND (subject_id=$2 OR subject_id IN(SELECT id FROM custom_dim.agent_assignments WHERE influencer_id=$2) OR subject_id IN(SELECT id FROM custom_dim.conversations WHERE influencer_id=$2))",
      [actor.organizationId, id],
    );
    if (command.status === "offboarding")
      await db.query(
        "UPDATE custom_dim.account_integrations SET status='revocation_pending' WHERE organization_id=$1 AND social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$2)",
        [actor.organizationId, id],
      );
  }
  await audit(db, actor, "transition", "influencers", id, {
    from: identity.status,
    to: command.status,
    reason: command.reason,
  });
  await event(
    db,
    actor,
    command.status === "offboarding"
      ? "identity.offboard"
      : "identity.status_changed",
    id,
    { status: command.status },
  );
  return row;
}
export async function patchIdentity(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const data = identityInput
    .partial()
    .extend({ row_version: z.number().int().positive() })
    .strict()
    .parse(input);
  const current = await resource(db, "influencers", id, actor);
  authorize(actor, "identity.write", { influencerId: id });
  demand(
    !data.type || data.type === current.type,
    "TYPE_IMMUTABLE",
    "Crie uma identidade distinta para outro tipo",
  );
  if (data.owner_user_id) await member(db, actor, data.owner_user_id);
  const { row_version, ...fields } = data;
  const entries = Object.entries(fields);
  demand(entries.length, "EMPTY_PATCH", "Informe ao menos um campo");
  const row = await one(
    db,
    `UPDATE custom_dim.influencers SET ${entries.map(([k], i) => `${k}=$${i + 1}`).join(",")},row_version=row_version+1 WHERE id=$${entries.length + 1} AND organization_id=$${entries.length + 2} AND row_version=$${entries.length + 3} RETURNING *`,
    [...entries.map(([, v]) => v), id, actor.organizationId, row_version],
  );
  demand(row, "VERSION_CONFLICT", "O cadastro foi alterado; recarregue", 409);
  await audit(db, actor, "update", "influencers", id, row);
  return row;
}
export async function persona(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  await resource(db, "influencers", id, actor);
  authorize(actor, "governance.write", { influencerId: id });
  const data = z
    .object({
      public_bio: text,
      tone: json,
      traits: json,
      knowledge: json,
      boundaries: json,
      approval_status: z.enum(["draft", "approved"]),
    })
    .strict()
    .parse(input);
  if (data.approval_status === "approved")
    authorize(actor, "approval.write", { influencerId: id });
  await db.query(
    "SELECT id FROM custom_dim.influencers WHERE id=$1 FOR UPDATE",
    [id],
  );
  const previous = await one(
    db,
    "SELECT coalesce(max(version),0) AS n FROM custom_dim.influencer_personas WHERE influencer_id=$1",
    [id],
  );
  const row = await insert(db, "influencer_personas", {
    ...data,
    organization_id: actor.organizationId,
    influencer_id: id,
    version: Number(previous?.n) + 1,
    approved_at:
      data.approval_status === "approved" ? new Date().toISOString() : null,
  });
  await audit(db, actor, "version", "influencer_personas", row.id, {
    version: row.version,
  });
  return row;
}
export async function saveOnboarding(
  db: DB,
  actor: Actor,
  id: string,
  input: unknown,
) {
  const data = z
    .object({
      step_code: z.enum([
        "identity",
        "rights",
        "approval",
        "infrastructure",
        "accounts",
        "editorial",
        "tests",
        "activation",
      ]),
      data: json,
      status: z.enum(["pending", "in_progress"]),
    })
    .strict()
    .parse(input);
  const session = await resource(db, "onboarding_sessions", id, actor);
  authorize(actor, "identity.write", { influencerId: session.influencer_id });
  await db.query(
    "UPDATE custom_dim.onboarding_steps SET data=$1,status=CASE WHEN data=$1::jsonb AND status='completed' THEN status ELSE $2 END,completed_by=CASE WHEN data=$1::jsonb AND status='completed' THEN completed_by ELSE $3 END,completed_at=CASE WHEN data=$1::jsonb AND status='completed' THEN completed_at ELSE $4 END WHERE session_id=$5 AND step_code=$6",
    [
      JSON.stringify(data.data),
      data.status,
      actor.userId,
      null,
      id,
      data.step_code,
    ],
  );
  await db.query(
    "UPDATE custom_dim.onboarding_sessions SET current_step=$1 WHERE id=$2",
    [data.step_code, id],
  );
  await audit(db, actor, "autosave", "onboarding_sessions", id, {
    step: data.step_code,
  });
  return { saved: true };
}
export async function revokeConsent(
  db: DB,
  actor: Actor,
  table: "identity_consents" | "consent_records",
  id: string,
) {
  const original = await resource(db, table, id, actor);
  authorize(
    actor,
    table === "identity_consents" ? "governance.write" : "inbox.write",
    { influencerId: original.influencer_id },
  );
  const {
    id: _id,
    created_at: _created,
    updated_at: _updated,
    ...copy
  } = original;
  const row = await insert(db, table, {
    ...copy,
    revoked_at: new Date().toISOString(),
    supersedes_id: id,
  });
  await audit(db, actor, "revoke", table, row.id, { supersedes_id: id });
  if (table === "identity_consents") {
    await db.query(
      "UPDATE custom_dim.publication_jobs SET status='cancelled' WHERE organization_id=$1 AND status IN('queued','retry') AND social_account_id IN(SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$2)",
      [actor.organizationId, original.influencer_id],
    );
    await event(db, actor, "identity.consent_revoked", original.influencer_id);
  }
  return row;
}
export const assignmentInput = z.object({
  user_id: uuid,
  responsibility: z.enum(["editor", "manager"]),
});
