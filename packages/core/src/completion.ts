import {z} from 'zod';
import {demand,uuid,text,timestamp,type Actor} from '../../contracts/src/index';
import {insert,one,type DB} from '../../db/src/index';
import {audit,authorize,event,resource} from './security';
import {activationBlockers,rightsBlockers,transition} from './identity';
import {publicationGuard} from './editorial';

export const onboardingCodes=['identity','rights','approval','infrastructure','accounts','editorial','tests','activation'] as const;
export async function onboardingChecklist(db:DB,actor:Actor,sessionId:string) {
  const session=await resource(db,'onboarding_sessions',sessionId,actor);authorize(actor,'identity.read',{influencerId:session.influencer_id});
  const identity=await resource(db,'influencers',session.influencer_id,actor);
  const tasks=(await db.query('SELECT * FROM custom_dim.onboarding_tasks WHERE session_id=$1 ORDER BY due_at NULLS LAST,created_at',[sessionId])).rows;
  const steps=(await db.query('SELECT * FROM custom_dim.onboarding_steps WHERE session_id=$1',[sessionId])).rows;
  const accounts=(await db.query('SELECT id,handle,account_status,integration_status FROM custom_dim.social_accounts WHERE influencer_id=$1',[identity.id])).rows;
  const blockers=await activationBlockers(db,actor,identity);
  if(tasks.some(t=>t.status!=='completed'))blockers.push('pending_onboarding_tasks');
  return {identity,session,tasks,steps,accounts,blockers:[...new Set(blockers)]};
}
export async function completeOnboardingStep(db:DB,actor:Actor,sessionId:string,code:string) {
  const session=await resource(db,'onboarding_sessions',sessionId,actor);authorize(actor,'identity.write',{influencerId:session.influencer_id});
  demand(onboardingCodes.includes(code as any)&&code!=='activation','INVALID_STEP','Etapa inválida');
  const identity=await resource(db,'influencers',session.influencer_id,actor);
  if(code==='rights') {const blockers=await rightsBlockers(db,actor,identity);demand(!blockers.length,'RIGHTS_REQUIRED',blockers.join(', '));}
  if(code==='approval') {const decision=await one(db,'SELECT decision FROM custom_dim.onboarding_approvals WHERE session_id=$1 ORDER BY decided_at DESC NULLS LAST,created_at DESC LIMIT 1',[sessionId]);demand(decision?.decision==='approved','APPROVAL_REQUIRED','Aprovação humana necessária');}
  if(code==='accounts') demand(await one(db,"SELECT id FROM custom_dim.social_accounts WHERE influencer_id=$1 AND integration_status='connected' AND account_status='active'",[identity.id]),'CHANNEL_REQUIRED','Conecte ao menos um canal');
  if(code==='editorial') demand(await one(db,"SELECT id FROM custom_dim.approval_policies WHERE organization_id=$1 AND enabled=true AND resource_type='content'",[actor.organizationId]),'POLICY_REQUIRED','Defina a política editorial');
  if(['infrastructure','tests'].includes(code)) {const step=await one(db,'SELECT data FROM custom_dim.onboarding_steps WHERE session_id=$1 AND step_code=$2',[sessionId,code]);const proof=uuid.safeParse(step?.data.evidence_object_id);demand(proof.success,'EVIDENCE_REQUIRED','Anexe a evidência privada da etapa');const file=await resource(db,'storage_objects',proof.data,actor);demand(file.scan_status==='clean'&&file.influencer_id===identity.id,'INVALID_EVIDENCE','Evidência precisa estar liberada para esta identidade');}
  await db.query("UPDATE custom_dim.onboarding_steps SET status='completed',completed_by=$1,completed_at=now() WHERE session_id=$2 AND step_code=$3",[actor.userId,sessionId,code]);
  await audit(db,actor,'step_completed','onboarding_sessions',sessionId,{step:code});return {completed:true};
}
export async function finishOnboarding(db:DB,actor:Actor,sessionId:string,input:unknown) {
  const data=z.object({confirmed:z.literal(true),reason:text}).strict().parse(input);const checklist=await onboardingChecklist(db,actor,sessionId);authorize(actor,'identity.write',{influencerId:checklist.identity.id});
  if(checklist.session.status==='completed'&&checklist.identity.status==='active')return checklist.identity;
  demand(!checklist.blockers.length,'ACTIVATION_BLOCKED',checklist.blockers.join(', '));
  demand(onboardingCodes.filter(c=>c!=='activation').every(code=>checklist.steps.some(s=>s.step_code===code&&s.status==='completed')),'CHECKLIST_INCOMPLETE','Conclua as sete etapas anteriores');
  let identity=checklist.identity;const sequence=['draft','under_review','approved','provisioning','ready','active'];demand(sequence.includes(identity.status),'INVALID_TRANSITION','Estado exige revisão de governança');
  for(const status of sequence.slice(sequence.indexOf(identity.status)+1))identity=await transition(db,actor,identity.id,{status,reason:data.reason,row_version:identity.row_version});
  await db.query("UPDATE custom_dim.onboarding_steps SET status='completed',completed_by=$1,completed_at=now() WHERE session_id=$2 AND step_code='activation'",[actor.userId,sessionId]);
  await db.query("UPDATE custom_dim.onboarding_sessions SET status='completed',current_step='activation',completed_at=now() WHERE id=$1",[sessionId]);return identity;
}
export async function reschedule(db:DB,actor:Actor,id:string,input:unknown) {
  const data=z.object({scheduled_at:timestamp,row_version:z.number().int().positive()}).strict().parse(input);
  const job=await resource(db,'publication_jobs',id,actor);demand(['queued','retry'].includes(job.status),'JOB_IN_FLIGHT','Somente trabalhos pendentes podem ser reagendados',409);demand(new Date(data.scheduled_at)>new Date(),'SCHEDULE_IN_PAST','Escolha um horário futuro');
  await publicationGuard(db,actor,job);
  const updated=await one(db,"UPDATE custom_dim.publication_jobs SET scheduled_at=$1,row_version=row_version+1,status='queued' WHERE id=$2 AND row_version=$3 AND status IN('queued','retry') RETURNING *",[data.scheduled_at,id,data.row_version]);demand(updated,'VERSION_CONFLICT','Agendamento alterado por outro operador',409);
  await db.query('UPDATE custom_dim.editorial_calendar_items SET planned_at=$1 WHERE publication_job_id=$2',[data.scheduled_at,id]);await event(db,actor,'social.publish',id,{job_id:id});await audit(db,actor,'reschedule','publication_jobs',id,{scheduled_at:data.scheduled_at});return updated;
}
export const inboxPolicy=z.object({sla_hours:z.number().int().min(1).max(720),retention_days:z.number().int().min(1).max(3650),whatsapp_window_hours:z.number().int().min(1).max(24)}).strict();
export async function saveInboxPolicy(db:DB,actor:Actor,input:unknown) {
  authorize(actor,'security.write');const settings=inboxPolicy.parse(input);
  await db.query("INSERT INTO custom_dim.organization_settings(organization_id,module_key,settings) VALUES($1,'inbox',$2) ON CONFLICT(organization_id,module_key) DO UPDATE SET settings=excluded.settings,version=organization_settings.version+1",[actor.organizationId,JSON.stringify(settings)]);await audit(db,actor,'inbox_policy','organizations',actor.organizationId,settings);return settings;
}
export async function conversationPreferences(db:DB,actor:Actor,id:string,input:unknown) {
  const data=z.object({tags:z.array(z.string().trim().min(1).max(40)).max(20).optional(),mark_read:z.literal(true).optional()}).strict().parse(input);const c=await resource(db,'conversations',id,actor);authorize(actor,'inbox.write',{influencerId:c.influencer_id,accountId:c.social_account_id});
  if(data.tags)await db.query('UPDATE custom_dim.conversations SET tags=$1 WHERE id=$2',[JSON.stringify([...new Set(data.tags)]),id]);
  if(data.mark_read)await db.query('UPDATE custom_dim.conversations SET unread_count=0,last_read_at=now() WHERE id=$1',[id]);await audit(db,actor,'preferences','conversations',id,data);return {updated:true};
}
export async function mergeContacts(db:DB,actor:Actor,sourceId:string,targetId:string,reason:string) {
  authorize(actor,'inbox.write');demand(sourceId!==targetId,'SAME_CONTACT','Escolha dois contatos distintos');
  const source=await resource(db,'contacts',sourceId,actor),target=await resource(db,'contacts',targetId,actor);demand(!source.merged_into_id&&!target.merged_into_id,'ALREADY_MERGED','Um contato já possui unificação',409);
  // Keep consent/proof/message ownership unchanged. This is an explicit link, never an automatic consent transfer.
  await db.query("UPDATE custom_dim.contacts SET merged_into_id=$1,status='merged' WHERE id=$2",[targetId,sourceId]);
  await audit(db,actor,'manual_merge','contacts',sourceId,{target_id:targetId,reason});return {source_id:sourceId,target_id:targetId,consent_transferred:false};
}
export async function exportContact(db:DB,actor:Actor,id:string) {
  authorize(actor,'inbox.write');const contact=await resource(db,'contacts',id,actor);
  const consents=(await db.query('SELECT * FROM custom_dim.consent_records WHERE contact_id=$1',[id])).rows;
  const conversations=(await db.query('SELECT * FROM custom_dim.conversations WHERE contact_id=$1',[id])).rows;
  const messages=(await db.query('SELECT m.* FROM custom_dim.messages m JOIN custom_dim.conversations c ON c.id=m.conversation_id WHERE c.contact_id=$1',[id])).rows;
  await audit(db,actor,'authorized_export','contacts',id);return {contact,consents,conversations,messages,exported_at:new Date().toISOString()};
}
