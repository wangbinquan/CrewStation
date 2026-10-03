import type { ProjectDeletionContext, ProjectId, ServiceId } from '@crewstation/contracts';
import { ProjectDeletionContextSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, noopLogger, precondition } from '@crewstation/kernel';
import { runMigrations } from '@crewstation/persistence';
import { eventbusMigrations } from '@crewstation/eventbus';
import { queueMigrations } from '@crewstation/queue';
import { createTestDatabase } from '@crewstation/testkit';
import type { ProjectFacts } from '../api/steps';
import type { ProvisioningCallbackProcesses } from '../ports/projectWork';
import { createProvisioningModule } from '../wiring';
import { provisioningContainer } from '../domain/projectWork';

/** Actual PostgreSQL and module calls; the container source is controlled, not physical acceptance. */
export async function projectWorkFixture(options: { beforePodStopMigration?: boolean } = {}) {
  const database = await createTestDatabase([queueMigrations, eventbusMigrations]);
  const facts = new Map<ProjectId, ProjectFacts>(), calls: string[] = [], exits = new Set<string>(), waiting = new Map<string, () => void>();
  const native = { podUid: newResourceId(), nodeUid: newResourceId(), nodeName: 'controlled-node', containerId: 'containerd://' + 'a'.repeat(64),
    pid: process.pid, pidNamespace: '303', bootId: newResourceId(), startTicks: '1931' };
  let stopped = false, wholeStopped = false, permit = true, sourceFailure = false, protectedProcess = native;
  let repository: (value: ProjectFacts) => Promise<void> = async () => undefined;
  let stopIdentity = provisioningContainer(native), declared: () => Promise<void> = async () => undefined;
  let podIdentity = { podUid: native.podUid,nodeUid: native.nodeUid,nodeName: native.nodeName };
  let protecting: () => Promise<void> = async () => undefined;
  const processes: ProvisioningCallbackProcesses = { protectCurrent: async () => { await protecting(); return protectedProcess; },
    sweep: async (accept) => { if (sourceFailure) throw new Error('controlled-source-unavailable');
      if (stopped) await accept.stopped(stopIdentity, jsonHash({ actual: 'controlled-original-termination', stopIdentity }));
      if (wholeStopped) await accept.podStopped(podIdentity, jsonHash({ actual: 'controlled-whole-pod-termination', podIdentity }));
      await accept.releasable(native.podUid); } };
  const module = createProvisioningModule({ db: database.db, workerOwner: 'original-work-test', consumerName: 'original-work-test', logger: noopLogger,
    isAdmin: async () => true, projectWork: { processes, assertAvailable: async (id) => { const value = facts.get(id); if (!value || value.state === 'deleting') throw precondition('controlled-project-unavailable'); },
      assertGrant: async () => { if (!permit) throw precondition('controlled-grant-stale'); } },
    namespaces: { systemNamespace: 'controlled-system', pollMs: 1 },
    ledger: { declare: async (input) => { calls.push('declare:' + input.kind); await declared(); return { id: newResourceId() }; }, get: async (id) => ({ id, phase: 'ready', children: [] }) },
    steps: { loadProject: async (id) => facts.get(id), listProjects: async () => [...facts.values()],
      ensureRepository: async (value) => { calls.push('repository'); await repository(value); }, ensureData: async () => { calls.push('data'); },
      reconcileRoutes: async () => { calls.push('routes'); }, ensureFirstRelease: async () => { calls.push('release'); },
      setProjectState: async (id, state) => { const before = facts.get(id); if (before) facts.set(id, { ...before, state }); calls.push('state:' + state); } } });
  await runMigrations(database.db, [{ ...module.migrations,files: options.beforePodStopMigration ? module.migrations.files.slice(0,1) : module.migrations.files }]);
  const listener = await database.handle.client.listen('provisioning_test_exit', (id) => { exits.add(id); waiting.get(id)?.(); waiting.delete(id); });
  await database.handle.client.unsafe(`CREATE FUNCTION provisioning.notify_test_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.exited_at IS NOT NULL THEN PERFORM pg_notify('provisioning_test_exit',NEW.id);END IF;RETURN NEW;END $$;
    CREATE TRIGGER provisioning_test_exit AFTER UPDATE ON provisioning.original_callbacks FOR EACH ROW EXECUTE FUNCTION provisioning.notify_test_exit()`);
  const create = () => { const projectId = newResourceId() as ProjectId, serviceId = newResourceId() as ServiceId;
    const value: ProjectFacts = { projectId, serviceId, state: 'provisioning', slug: 'controlled-' + projectId.slice(-6), name: 'Controlled original work',
      namespace: 'controlled-' + projectId.slice(-6), kind: 'DigitalWorker', template: newResourceId() }; facts.set(projectId, value); return value; };
  const context = (value: ProjectFacts): ProjectDeletionContext => ProjectDeletionContextSchema.parse({ operationId: newResourceId(), generation: 1, phase: 'seal',
    target: { id: value.projectId, serviceId: value.serviceId, slug: value.slug, name: value.name, namespace: value.namespace, kind: value.kind, state: 'deleting',
      revision: '1', prodHost: 'controlled.example', previewHost: 'preview.controlled.example', serviceHost: 'controlled.internal' },
    confirmed: { participant: 'provisioning', revision: jsonHash({ original: value.projectId }), complete: true, resources: [], references: [], blockers: [] } });
  if (!module.projectWork) throw new Error('formal original work was not mounted');
  return { database, module, work: module.projectWork, create, context, calls, native, facts,
    repository: (value: typeof repository) => { repository = value; }, stopped: (value: boolean) => { stopped = value; }, permit: (value: boolean) => { permit = value; },
    sourceFailure: (value: boolean) => { sourceFailure = value; }, protect: (value: typeof native) => { protectedProcess = value; },
    stopIdentity: (value: typeof stopIdentity) => { stopIdentity = value; }, declared: (value: typeof declared) => { declared = value; },
    wholeStopped: (value: boolean) => { wholeStopped = value; }, podIdentity: (value: typeof podIdentity) => { podIdentity = value; },
    protecting: (value: typeof protecting) => { protecting = value; },
    waitExit: (id: string) => exits.has(id) ? Promise.resolve() : new Promise<void>((resolve) => { waiting.set(id, resolve); }),
    drop: async () => { for (const task of module.startupTasks) await task.stop(); await listener.unlisten(); await database.drop(); } };
}
