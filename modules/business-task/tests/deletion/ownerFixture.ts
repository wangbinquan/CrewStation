import { ProjectDeletionContextSchema, TaskIdSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { businessDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { businessDeletionOwner } from '../../application/execution/deletion/owner';
import { businessWorkFixture } from './workFixture';

export async function businessOwnerFixture() {
  const f = await businessWorkFixture(), task = TaskIdSchema.parse(newResourceId()), child = newResourceId(), home = newResourceId(), execution = newResourceId();
  const recovery = newResourceId(), finalization = newResourceId(), operation = newResourceId(), oldTask = 'historical-business-task';
  const sources = { ...f.sources, resolve: async (kind: 'service' | 'task', key: string, representation: 'current' | 'legacy') => kind === 'service' ? f.sources.resolve(kind, key, representation)
    : [task, home, oldTask].includes(key) ? { complete: true as const, id: key === oldTask ? task : key, scope: 'project' as const, projectIds: [f.projectId], revision: jsonHash({ key: key === oldTask ? task : key, project: f.projectId }) } : undefined };
  const repo = () => businessDeletionRepository(f.database.db, sources), owner = () => businessDeletionOwner(repo(), sources);
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionPhase = 'seal', generation = 1) => ProjectDeletionContextSchema.parse({ ...f.context(), confirmed, phase, generation });
  const seed = async () => {
    const db = f.database.db, service = f.serviceId, project = f.projectId, hash = jsonHash('private-content');
    await db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
      VALUES(${task},${service},${project},'private-caller','closed','private-trace','persistent','private-profile','{"private":"labels"}',now(),now())`);
    await db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
      VALUES(${newResourceId()},${f.otherService},${f.otherProject},'other-caller','closed','other-trace','persistent','other-profile','{}',now(),now())`);
    await db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,output,created_at)
      VALUES(${newResourceId()},${task},'private-child','agent','succeeded',1,'{}','private-output',now())`);
    await db.execute(sql`INSERT INTO business_task.contracts(release_id,service_id,tag,agent_profiles,output_contracts,registered_at)
      VALUES(${newResourceId()},${service},'private-tag','{"private":"agent"}','{"private":"contract"}',now())`);
    await db.execute(sql`INSERT INTO business_task.cluster_commands(id,body,legacy_body) VALUES(${newResourceId()},${JSON.stringify({ operation: { target: { taskId: task } }, private: 'command' })}::jsonb,${JSON.stringify({ operation: { target: { taskId: oldTask } } })}::jsonb)`);
    await db.execute(sql`INSERT INTO business_task.execution_operations(id,service_id,kind,parent_id,request_key,request_digest,effective_digest,intent,state,created_at,updated_at)
      VALUES(${operation},${service},'create-task','','original-key',${hash},${hash},${JSON.stringify({ projectId: project, task: { id: task, serviceId: service }, private: 'accepted' })}::jsonb,'succeeded',now(),now())`);
    await db.execute(sql`INSERT INTO business_task.execution_controls(service_id,body) VALUES(${service},'{"private":"control"}')`);
    await db.execute(sql`INSERT INTO business_task.legacy_mutations(id,service_id,kind,task_id,state) VALUES(${newResourceId()},${service},'private-launch',${task},'complete')`);
    await db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state) VALUES(${home},${service},${task},'private-volume','idle')`);
    await db.execute(sql`INSERT INTO business_task.execution_subtasks(id,service_id,task_id,request_key,request_digest,sealed_payload,payload_digest,fenced,view,dispatch,session_key,session_volume_uid,updated_at)
      VALUES(${child},${service},${task},'private-child',${hash},'private-sealed-payload',${hash},false,${JSON.stringify({ id: child, taskId: task, executionId: execution })}::jsonb,'accepted',${home},'private-volume',now())`);
    await db.execute(sql`INSERT INTO business_task.subtask_projections(subtask_id,stdout,stderr) VALUES(${child},'private-stdout','private-stderr')`);
    await db.execute(sql`INSERT INTO business_task.execution_events(service_id,task_id,sequence,subtask_id,source_sequence,digest,event) VALUES(${service},${task},1,${child},1,${hash},'{"private":"event"}')`);
    await db.execute(sql`INSERT INTO business_task.execution_cancellations(id,service_id,task_id,subtask_id,request_key,request_digest,expected_attempt,state,updated_at)
      VALUES(${newResourceId()},${service},${task},${child},'private-cancel',${hash},1,'succeeded',now())`);
    await db.execute(sql`INSERT INTO business_task.execution_task_states(task_id,service_id,generation,state) VALUES(${task},${service},1,'closed')`);
    await db.execute(sql`INSERT INTO business_task.execution_lifecycles(id,service_id,task_id,action,request_key,expected_generation,generation,prior_state,state,updated_at)
      VALUES(${newResourceId()},${service},${task},'pause','private-life',1,2,'running','succeeded',now())`);
    await db.execute(sql`INSERT INTO business_task.execution_logs(task_id,service_id) VALUES(${task},${service})`);
    await db.execute(sql`INSERT INTO business_task.execution_materials(id,service_id,task_id,request_key,digest,sealed,size_bytes,created_at)
      VALUES(${newResourceId()},${service},${task},'private-material',${hash},'private-content',64,now())`);
    await db.execute(sql`INSERT INTO business_task.execution_messages(id,service_id,task_id,subtask_id,request_key,request_digest,attempt,execution_id,runtime_task_id,incarnation,payload_digest,sealed_payload,state,updated_at)
      VALUES(${newResourceId()},${service},${task},${child},'private-message',${hash},1,${execution},${task},${newResourceId()},${hash},'private-message-content','succeeded',now())`);
    await db.execute(sql`INSERT INTO business_task.execution_sessions(service_id,task_id,session_id,session_key,source_execution_id) VALUES(${service},${task},'private-session',${home},${execution})`);
    await db.execute(sql`INSERT INTO business_task.recovery_requests(id,service_id,project_id,task_id,target_key,request_key,request_digest,requested_by,target,assessment_digest,state,created_at,updated_at)
      VALUES(${recovery},${service},${project},${task},'private-target','private-recovery',${hash},'private-user','{}',${hash},'succeeded',now(),now())`);
    await db.execute(sql`INSERT INTO business_task.recovery_audit(id,request_id,event,actor,at) VALUES(${newResourceId()},${recovery},'succeeded','private-user',now())`);
    await db.execute(sql`INSERT INTO business_task.storage_control_outbox(service_id,version,body,updated_at) VALUES(${service},1,'{"private":"outbox"}',now())`);
    const body = { id: finalization, projectId: project, serviceId: service, view: { taskId: task }, private: 'archive' };
    await db.execute(sql`INSERT INTO business_task.finalizations(id,service_id,task_id,body,phase) VALUES(${finalization},${service},${task},${JSON.stringify(body)}::jsonb,'completed')`);
    await db.execute(sql`INSERT INTO business_task.finalization_execution_proofs(operation_id,subtask_id,body) VALUES(${finalization},${child},'{"private":"proof"}')`);
    await db.execute(sql`INSERT INTO business_task.finalization_revisions(id,finalization_id,request_key,body) VALUES(${newResourceId()},${finalization},'private-revision','{"private":"revision"}')`);
    await f.work.run(f.input(), async () => undefined);
  };
  return { ...f, task, child, home, sources, repo, owner, context, seed, target: f.context().target };
}
