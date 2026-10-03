import type { ProjectDeletionContext, ProjectId } from '@crewstation/contracts';
import { ProjectDeletionContextSchema, ProjectIdSchema, ServiceIdSchema, TaskIdSchema, ReleaseIdSchema, TraceIdSchema } from '@crewstation/contracts';
import { eventbusMigrations } from '@crewstation/eventbus';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { businessProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { drizzleExecutionOperations } from '../../adapters/persistence/executionOperations';
import type { BusinessDeletionOrigin } from '../../domain/deletion/content';
import type { OperationCandidate } from '../../domain/taskAdmission';
import type { BusinessWorkProcesses, BusinessWorkSources } from '../../ports/deletion/work';
import { businessTaskMigrations } from '../../wiring';

/** Real PostgreSQL; Project grants and original whole-Pod observations are controlled ports, not cluster acceptance. */
export async function businessWorkFixture() {
  const database = await createTestDatabase([eventbusMigrations, businessTaskMigrations]);
  const projectId = ProjectIdSchema.parse(newResourceId()), serviceId = ServiceIdSchema.parse(newResourceId());
  const otherProject = ProjectIdSchema.parse(newResourceId()), otherService = ServiceIdSchema.parse(newResourceId()), operationId = newResourceId();
  const native = { podUid: newResourceId(), nodeUid: newResourceId(), nodeName: 'controlled-node', containerId: 'containerd://' + 'a'.repeat(64),
    pid: process.pid, pidNamespace: '303', bootId: newResourceId(), startTicks: '1931' };
  const origins = new Map<string, BusinessDeletionOrigin>();
  const bind = (id: string, project: ProjectId) => origins.set(id, { complete: true, id, scope: 'project', projectIds: [project], revision: jsonHash({ id, project }) });
  bind(serviceId, projectId); bind(otherService, otherProject);
  let permitted = true, deleting = false, stopped = false, containerStopped = false;
  let protectedProcess = native, stoppedPod = { podUid: native.podUid, nodeUid: native.nodeUid, nodeName: native.nodeName };
  let protecting: () => Promise<void> = async () => undefined;
  let checkingGrant: () => Promise<void> = async () => undefined;
  const releasable: boolean[] = [], exits = new Set<string>(), waiters = new Map<string, () => void>();
  const processes: BusinessWorkProcesses = { protectCurrent: async () => { await protecting(); return protectedProcess; },
    sweep: async (accept) => {
      if (containerStopped) await accept.stopped({ ...stoppedPod, containerId: native.containerId }, jsonHash('controlled-single-container-stop'));
      if (stopped) await accept.podStopped(stoppedPod, jsonHash({ controlledWholePodStop: stoppedPod })); releasable.push(await accept.releasable(native.podUid));
    } };
  const sources: BusinessWorkSources = { processes, resolve: async (kind, key) => kind === 'service' ? origins.get(key) : undefined,
    assertAvailable: async (id) => { if (id === projectId && deleting) throw precondition('controlled-project-deleting'); },
    assertGrant: async (context) => { await checkingGrant(); if (!permitted || context.operationId !== operationId || context.target.id !== projectId) throw precondition('controlled-grant-unavailable'); } };
  const work = businessProjectWork(database.db, sources), operations = drizzleExecutionOperations(database.db);
  const listener = await database.handle.client.listen('business_test_exit', (id) => { exits.add(id); waiters.get(id)?.(); waiters.delete(id); });
  await database.handle.client.unsafe(`CREATE FUNCTION business_task.notify_test_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.exited_at IS NOT NULL THEN PERFORM pg_notify('business_test_exit',NEW.id);END IF;RETURN NEW;END $$;
    CREATE TRIGGER business_test_exit AFTER UPDATE ON business_task.original_callbacks FOR EACH ROW EXECUTE FUNCTION business_task.notify_test_exit()`);
  const input = (project = projectId, service = serviceId) => ({ projectId: project, serviceId: service, kind: 'task-admission' as const, reference: newResourceId(), inputDigest: jsonHash('controlled-input') });
  const context = (): ProjectDeletionContext => ProjectDeletionContextSchema.parse({ operationId, generation: 1, phase: 'seal',
    target: { id: projectId, serviceId, slug: 'controlled', name: 'Controlled original work', namespace: 'cs-controlled', kind: 'DigitalWorker', state: 'deleting',
      revision: '1', prodHost: 'controlled.example', previewHost: 'preview.controlled.example', serviceHost: 'controlled.internal' },
    confirmed: { participant: 'business-task', revision: jsonHash({ original: projectId }), complete: true, resources: [], references: [], blockers: [] } });
  const candidate = (project = projectId, service = serviceId): OperationCandidate => {
    const taskId = TaskIdSchema.parse(newResourceId()), profile = newResourceId();
    const intent: OperationCandidate['intent'] = { kind: 'create-task', projectId: project, callerIdentity: 'controlled/worker', environmentLabels: {},
      tasksSpec: { taskProfileId: profile, defaultVolumeMode: 'persistent', agentProfiles: [], outputContracts: [] },
      task: { id: taskId, serviceId: service, state: 'admitting', releaseId: ReleaseIdSchema.parse(newResourceId()), taskContractVersion: 'v1', contractDigest: 'a'.repeat(64), generation: 1,
        volumeMode: 'persistent', volumeUid: null, taskProfileId: profile, traceId: TraceIdSchema.parse('0123456789abcdef0123456789abcdef'), labels: {},
        resourceState: 'admitting', quotaHeld: false, createdAt: new Date().toISOString() } };
    return { id: newResourceId(), serviceId: service, kind: 'create-task', parentId: '', requestKey: newResourceId(), requestDigest: jsonHash('request'), effectiveDigest: jsonHash(intent), intent, epoch: null };
  };
  const waitSeal = async (project = projectId) => {
    const deadline = Date.now() + 3000, admissionKey = 'business-task.project-admission:' + project;
    while (Date.now() < deadline) {
      const [state] = await database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
        AND classid=((hashtextextended(${admissionKey},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${admissionKey},0)&4294967295)::oid AND objsubid=1) AS waiting`);
      if (state!.waiting) return; await Bun.sleep(10);
    }
    throw new Error('the original exclusive seal did not start waiting');
  };
  return { database, work, sources, processes, origins, bind, input, context, candidate, operations, native, projectId, serviceId, otherProject, otherService, releasable,
    permit: (value: boolean) => { permitted = value; }, deleting: (value: boolean) => { deleting = value; }, stopped: (value: boolean) => { stopped = value; },
    containerStopped: (value: boolean) => { containerStopped = value; },
    protect: (value: typeof native) => { protectedProcess = value; }, stopIdentity: (value: typeof stoppedPod) => { stoppedPod = value; },
    protecting: (value: typeof protecting) => { protecting = value; },
    checkingGrant: (value: typeof checkingGrant) => { checkingGrant = value; },
    waitExit: (id: string) => exits.has(id) ? Promise.resolve() : new Promise<void>((resolve) => { waiters.set(id, resolve); }),
    waitSeal, drop: async () => { await listener.unlisten(); await database.drop(); } };
}
