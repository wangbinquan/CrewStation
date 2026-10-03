import { ProjectIdSchema, ServiceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import type { MigrationSet } from '@crewstation/persistence';
import type { RuntimeDeletionOrigin } from '../../domain/deletion/content';
import type { RuntimeDeletionSources } from '../../ports/deletion/sources';
import { runtimeContentSnapshot } from '../../adapters/persistence/deletion/inspection';
import { DevelopmentParentEpochSchema, developmentParentEpochHash } from '../../domain/development/parentEnding';
import { taskRuntimeMigrations } from '../../wiring';

/** Actual owner PostgreSQL, controlled original public identities; this fixture provides no physical stop evidence. */
export async function runtimeContentFixture(extra: MigrationSet[] = []) {
  const database = await createTestDatabase([...extra, taskRuntimeMigrations]);
  const project = ProjectIdSchema.parse(newResourceId()), otherProject = ProjectIdSchema.parse(newResourceId());
  const service = ServiceIdSchema.parse(newResourceId()), otherService = ServiceIdSchema.parse(newResourceId());
  const parent = TaskIdSchema.parse(newResourceId()), otherParent = TaskIdSchema.parse(newResourceId());
  const origins = new Map<string, RuntimeDeletionOrigin>(), unavailable = new Set<string>(), requests: string[] = [];
  const bind = (kind: 'project' | 'service' | 'business-task', key: string, projectId = project, id = key) => {
    const origin: RuntimeDeletionOrigin = { complete: true, id, scope: 'project', projectIds: [projectId], revision: jsonHash({ kind, id, projectId }) };
    origins.set(kind + ':' + key, origin); return origin;
  };
  bind('project', project); bind('service', service); bind('project', otherProject, otherProject); bind('service', otherService, otherProject);
  const sources: RuntimeDeletionSources = { resolve: async (kind, key, representation) => {
    const lookup = kind + ':' + key; requests.push(lookup + ':' + representation);
    if (unavailable.has(lookup)) throw new Error('original public source offline');
    return origins.get(lookup);
  } };
  const environment = async (input: { id?: string; projectId?: string; serviceId?: string; kind?: string; native?: unknown; render?: unknown } = {}) => {
    const id = input.id ?? newResourceId(), owner = input.projectId ?? project, ownerService = input.serviceId ?? service;
    await database.db.execute(sql`INSERT INTO task_runtime.environments(id,project_id,service_id,kind,state,volume_mode,profile,namespace,pod_name,pvc_name,trace_id,
      runner_token_hash,labels,native,render,created_at,updated_at,last_activity_at)
      VALUES(${id},${owner},${ownerService},${input.kind ?? 'dev-session'},'released','persistent','original-profile',${owner},${'original-pod-' + id},${'work-' + id},${newResourceId()},
        ${'1'.repeat(64)},'{}'::jsonb,${input.native === undefined ? null : JSON.stringify(input.native)}::jsonb,
        ${input.render === undefined ? null : JSON.stringify(input.render)}::jsonb,'2026-10-01T00:00:00Z','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`);
    return id;
  };
  await environment({ id: parent }); await environment({ id: otherParent, projectId: otherProject, serviceId: otherService });
  const native = (owner = parent) => ({ parentTaskId: owner, parentPodUid: newResourceId(), pvcUid: newResourceId(), nodeName: 'original-node',
    agentId: newResourceId(), runnerId: newResourceId(), fingerprint: jsonHash('original-input'), purpose: 'agent', image: 'original-image',
    profile: { id: newResourceId(), name: 'profile', cpu: '100m', memory: '128Mi', storage: '1Gi' }, state: 'finished' });
  return { database, project, otherProject, service, otherService, parent, otherParent, sources, origins, unavailable, requests, bind, environment, native,
    inspect: () => runtimeContentSnapshot(database.db, sources, project) };
}
export type RuntimeContentFixture = Awaited<ReturnType<typeof runtimeContentFixture>>;

/** Corrupt only this isolated test database to retain the read-only defenses for historical rows that predate SQL fences. */
export async function corruptRuntimeContent(f: Pick<RuntimeContentFixture, 'database'>, table: 'environments' | 'archive_executions' | 'environment_rebuilds', change: () => Promise<unknown>) {
  await f.database.db.execute(sql.raw('ALTER TABLE task_runtime.' + table + ' DISABLE TRIGGER runtime_all_content_guard'));
  try { await change(); }
  finally { await f.database.db.execute(sql.raw('ALTER TABLE task_runtime.' + table + ' ENABLE TRIGGER runtime_all_content_guard')); }
}

export async function seedRuntimeContent(f: RuntimeContentFixture) {
  const db = f.database.db, child = TaskIdSchema.parse(await f.environment({ native: f.native() })), ending = newResourceId(), rebuild = newResourceId();
  const epoch = DevelopmentParentEpochSchema.parse({ version: 1, parentId: f.parent, projectId: f.project, serviceId: f.service, kind: 'dev-session',
    volumeMode: 'persistent', namespace: f.project, podName: 'original-pod-' + f.parent, podUid: newResourceId(), pvcName: 'work-' + f.parent, pvcUid: newResourceId(),
    profile: 'original-profile', labels: {}, runnerTokenHash: '1'.repeat(64), originalRenderStart: null, acceptedRender: null });
  await db.execute(sql`INSERT INTO task_runtime.development_parent_endings(id,parent_id,project_id,operation,epoch,epoch_hash,selection_hash,intent,phase,status,retry_at,created_at,updated_at)
    VALUES(${ending},${f.parent},${f.project},'release',${JSON.stringify(epoch)}::jsonb,${developmentParentEpochHash(epoch)},${jsonHash('selection')},
      '{"private":"original-stop-intent"}'::jsonb,'admission-sealed','pending',now(),now(),now())`);
  await db.execute(sql`INSERT INTO task_runtime.development_parent_ending_children(ending_id,child_id,original_parent_pod_uid,snapshot,closed,closure)
    SELECT ${ending},id,native->>'parentPodUid',to_jsonb(r),true,'{"private":"original-numeric-tail"}'::jsonb FROM task_runtime.environments r WHERE id=${child}`);
  await db.execute(sql`UPDATE task_runtime.development_parent_endings SET phase='children',membership_frozen=true,member_count=1 WHERE id=${ending}`);
  await db.execute(sql`INSERT INTO task_runtime.development_parent_ending_objects(ending_id,kind,namespace,name,uid,materials_hash)
    VALUES(${ending},'Pod',${f.project},'original-owned-pod',${newResourceId()},${jsonHash('materials')})`);
  await db.execute(sql`INSERT INTO task_runtime.environment_rebuilds(id,task_id,project_id,input,namespace,original_pod_name,pod_name,pvc_name,secret_name,image,state,created_at,updated_at)
    VALUES(${rebuild},${f.parent},${f.project},${JSON.stringify({ expectedTaskId: f.parent, private: 'original-rebuild-input' })}::jsonb,
      ${f.project},'original-parent','replacement-parent','original-pvc','original-secret','image','failed',now(),now())`);
  await db.execute(sql`INSERT INTO task_runtime.development_parent_rebuild_claims(source_ending_id,current_rebuild_id,revision,after_transition_hash,state,retry_at)
    VALUES(${ending},${rebuild},1,${jsonHash('transition')},'released',now())`);
  const business = await f.environment({ kind: 'business' }), archive = newResourceId(), operation = newResourceId(), reserved = newResourceId();
  const input = { projectId: f.project, serviceId: f.service, taskId: business, operationId: operation, revision: 1, volumeUid: null };
  await db.execute(sql`INSERT INTO task_runtime.archive_executions(id,task_id,state,body) VALUES(${archive},${business},'stopped',
    ${JSON.stringify({ ...input, id: archive, state: 'stopped', private: 'archive-private-DSN' })}::jsonb)`);
  f.bind('business-task', reserved);
  await db.execute(sql`INSERT INTO task_runtime.unprovisioned_storage(task_id,body) VALUES(${reserved},
    ${JSON.stringify({ input: { ...input, taskId: reserved }, createdAt: '2026-10-01T00:00:00Z', proofId: null, private: 'never-provisioned-private' })}::jsonb)`);
  await db.execute(sql`INSERT INTO task_runtime.blocked_admissions(task_id,service_id) VALUES(${reserved},${f.service})`);
  await db.execute(sql`INSERT INTO task_runtime.admissions(project_id,running) VALUES(${f.project},0)`);
  await db.execute(sql`INSERT INTO task_runtime.development_parent_recovery_sweep(singleton,kind,scan_cutoff,after_id,epoch) VALUES(true,'ending',now(),${ending},1)`);
  return { child, ending, rebuild, business, archive, operation, reserved, epoch };
}
