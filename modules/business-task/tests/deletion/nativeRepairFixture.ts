import type { Actor, ProjectDeletionCurrentAssets } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { businessOperatorRepairs } from '../../adapters/persistence/deletion/operatorRepairs';
import { businessDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { businessDeletionOwner } from '../../application/execution/deletion/owner';
import { businessWorkFixture } from './workFixture';

/** Cancelled, unadmitted executions still have a durable session home; neither row is an original runtime witness. */
export async function nativeRepairFixture(native = true) {
  const f = await businessWorkFixture(), task = newResourceId(), runtime = newResourceId(), child = newResourceId(), execution = newResourceId(), volume = newResourceId();
  const actor: Actor = { userId: newResourceId() as Actor['userId'], isAdmin: true };
  let active = false, targetReference = false, identity = 'actual-current-source';
  const assets: ProjectDeletionCurrentAssets = { inspect: async () => ({ complete: true, digest: jsonHash(identity),
    activeConsumers: active ? ['current-consumer'] : [], targetReferences: targetReference ? ['target-reference'] : [] }) };
  const sources = { ...f.sources, currentAssets: assets, resolve: async (_kind: 'service' | 'task', key: string) => f.origins.get(key) };
  f.bind(task, f.otherProject);
  await f.database.db.execute(sql`INSERT INTO business_task.tasks(id,service_id,project_id,caller_identity,state,trace_id,volume_mode,profile,labels,created_at,updated_at)
    VALUES(${task},${f.otherService},${f.otherProject},'foreign','closed','trace','persistent','profile','{}',now(),now())`);
  if (native) {
    await f.database.db.execute(sql`INSERT INTO business_task.execution_session_homes(session_key,service_id,task_id,volume_uid,state)
      VALUES(${runtime},${f.otherService},${task},${volume},'idle')`);
    await f.database.db.execute(sql`INSERT INTO business_task.execution_subtasks(id,service_id,task_id,request_key,request_digest,sealed_payload,payload_digest,fenced,view,dispatch,runtime_task_id,runtime_released,session_key,session_volume_uid,updated_at)
      VALUES(${child},${f.otherService},${task},'cancelled-before-admission',${jsonHash('request')},'private-original-material',${jsonHash('material')},true,
      ${JSON.stringify({ id: child, taskId: task, executionId: execution, state: 'cancelled', endedAt: new Date().toISOString() })}::jsonb,'accepted',${runtime},true,${runtime},${volume},now())`);
  } else await f.database.db.execute(sql`INSERT INTO business_task.subtasks(id,task_id,name,kind,state,attempt,spec,created_at)
    VALUES(${child},${task},'legacy-unknown','agent','failed',1,${JSON.stringify({ execution: { taskId: runtime } })}::jsonb,now())`);
  const repair = () => businessOperatorRepairs(f.database.db, sources, assets), repo = () => businessDeletionRepository(f.database.db, sources);
  const read = () => f.database.db.execute(sql`SELECT * FROM (SELECT 'execution_subtasks' AS kind,to_jsonb(r) AS body FROM business_task.execution_subtasks r
    UNION ALL SELECT 'execution_session_homes',to_jsonb(r) FROM business_task.execution_session_homes r
    UNION ALL SELECT 'subtasks',to_jsonb(r) FROM business_task.subtasks r) whole_rows ORDER BY kind,body::text`);
  return { ...f, task, runtime, child, execution, volume, sources, assets, actor, repair, repo, read, owner: () => businessDeletionOwner(repo(), sources),
    active: (value: boolean) => { active = value; }, targetReference: (value: boolean) => { targetReference = value; }, identity: (value: string) => { identity = value; } };
}
