import { ProjectDeletionContextSchema, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionInventory, ProjectDeletionPhase } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { sql } from 'drizzle-orm';
import { developmentProjectWork } from '../../adapters/persistence/deletion/projectWork';
import { developmentDeletionRepository } from '../../adapters/persistence/deletion/repository';
import { developmentDeletionOwner } from '../../application/deletion/owner';
import type { DevelopmentWorkInput } from '../../domain/deletion/work';
import type { DevelopmentWorkProcesses, DevelopmentWorkSources } from '../../ports/deletion/work';
import { developmentContentFixture } from './contentFixture';

/** Actual PG. Public original identities, grants and Pod stop witnesses are controlled; this is no cluster cleanup acceptance. */
export async function developmentWorkFixture() {
  const f = await developmentContentFixture(), operationId = newResourceId();
  const native = { podUid: newResourceId(), nodeUid: newResourceId(), nodeName: 'controlled-development-node', containerId: 'containerd://' + 'b'.repeat(64),
    pid: process.pid, pidNamespace: '701', bootId: newResourceId(), startTicks: '2331' };
  let stopped = false, containerStopped = false, deleting = false, permitted = true, protectedProcess = native;
  let stoppedPod = { podUid: native.podUid, nodeUid: native.nodeUid, nodeName: native.nodeName };
  let checkingGrant: () => Promise<void> = async () => undefined;
  const releasable: boolean[] = [], exits = new Set<string>(), waiters = new Map<string, () => void>(), lifetimeErrors: unknown[] = [];
  const processes: DevelopmentWorkProcesses = { protectCurrent: async () => protectedProcess, sweep: async (accept) => {
    if (containerStopped) await accept.stopped({ ...stoppedPod, containerId: native.containerId }, jsonHash('controlled-single-development-container-stop'));
    if (stopped) await accept.podStopped(stoppedPod, jsonHash({ controlledWholePodStop: stoppedPod }));
    releasable.push(await accept.releasable(native.podUid));
  } };
  const sources: DevelopmentWorkSources = { ...f.sources, processes,
    assertAvailable: async (id) => { if (deleting && id === f.project) throw precondition('controlled-project-deleting'); },
    assertGrant: async (context) => { await checkingGrant(); if (!permitted || context.operationId !== operationId || context.target.id !== f.project) throw precondition('controlled-grant-unavailable'); } };
  const work = developmentProjectWork(f.database.db, sources, (error) => lifetimeErrors.push(error));
  const target = ProjectDeletionTargetSchema.parse({ id: f.project, serviceId: newResourceId(), slug: 'controlled-development', name: 'Controlled original development', namespace: 'cs-controlled-development',
    kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'controlled.example', previewHost: 'preview.controlled.example', serviceHost: 'controlled.internal' });
  const context = (confirmed: ProjectDeletionInventory, phase: ProjectDeletionPhase = 'seal', generation = 1) => ProjectDeletionContextSchema.parse({ operationId, generation, phase, target, confirmed });
  const repo = () => developmentDeletionRepository(f.database.db, sources), owner = () => developmentDeletionOwner(repo(), sources);
  const input = (project = f.project, workspace = f.workspace): DevelopmentWorkInput => ({ projectId: project, originKind: 'task', originKey: workspace,
    kind: 'task-api', reference: newResourceId(), inputDigest: jsonHash('controlled-development-request') });
  const listener = await f.database.handle.client.listen('development_test_exit', (id) => { exits.add(id); waiters.get(id)?.(); waiters.delete(id); });
  await f.database.handle.client.unsafe(`CREATE FUNCTION dev_session.notify_test_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.exited_at IS NOT NULL THEN PERFORM pg_notify('development_test_exit',NEW.id);END IF;RETURN NEW;END $$;
    CREATE TRIGGER development_test_exit AFTER UPDATE ON dev_session.original_callbacks FOR EACH ROW EXECUTE FUNCTION dev_session.notify_test_exit()`);
  const waitSeal = async () => {
    const deadline = Date.now() + 3000, admissionKey = 'dev-session.project-admission:' + f.project;
    while (Date.now() < deadline) {
      const [state] = await f.database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
        AND classid=((hashtextextended(${admissionKey},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${admissionKey},0)&4294967295)::oid AND objsubid=1) AS waiting`);
      if (state!.waiting) return; await Bun.sleep(10);
    }
    throw new Error('the original development exclusive seal did not start waiting');
  };
  return { ...f, sources, work, target, input, context, repo, owner, processIdentity: native, processes, lifetimeErrors, releasable,
    stopped: (value: boolean) => { stopped = value; }, containerStopped: (value: boolean) => { containerStopped = value; },
    stopIdentity: (value: typeof stoppedPod) => { stoppedPod = value; }, protect: (value: typeof native) => { protectedProcess = value; },
    deleting: (value: boolean) => { deleting = value; }, permit: (value: boolean) => { permitted = value; },
    checkingGrant: (value: typeof checkingGrant) => { checkingGrant = value; }, waitSeal,
    waitExit: (id: string) => exits.has(id) ? Promise.resolve() : new Promise<void>((resolve) => { waiters.set(id, resolve); }),
    drop: async () => { await listener.unlisten(); await f.database.drop(); } };
}
