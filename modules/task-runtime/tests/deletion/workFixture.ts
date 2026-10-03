import { ProjectDeletionContextSchema, ProjectDeletionTargetSchema } from '@crewstation/contracts';
import type { ProjectDeletionPhase } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { withExclusiveDatabaseAdmission } from '@crewstation/persistence';
import type { MigrationSet } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { runtimeProjectAdmissionKey, runtimeProjectWork } from '../../adapters/persistence/deletion/projectWork';
import type { RuntimeWorkInput } from '../../domain/deletion/work';
import type { RuntimeWorkSources } from '../../ports/deletion/work';
import { runtimeContentFixture } from './contentFixture';

/** Actual PG admission and callback lifetimes; public grants and whole-Pod observations are controlled ports. */
export async function runtimeWorkFixture(extra: MigrationSet[] = []) {
  const f = await runtimeContentFixture(extra), operationId = newResourceId();
  const original = { podUid: newResourceId(), nodeUid: newResourceId(), nodeName: 'controlled-runtime-node', containerId: 'containerd://' + 'c'.repeat(64),
    pid: process.pid, pidNamespace: '711', bootId: newResourceId(), startTicks: '2341' };
  let stopped = false, containerStopped = false, deleting = false, permitted = true, identity = original;
  let stoppedPod = { podUid: original.podUid, nodeUid: original.nodeUid, nodeName: original.nodeName };
  let checkingGrant: () => Promise<void> = async () => undefined;
  const releasable: boolean[] = [], errors: unknown[] = [], exits = new Set<string>(), waiters = new Map<string, () => void>();
  const sources: RuntimeWorkSources = { ...f.sources, processes: {
    protectCurrent: async () => identity, sweep: async (accept) => {
      if (containerStopped) await accept.stopped({ ...stoppedPod, containerId: original.containerId }, jsonHash('controlled-single-runtime-container-stop'));
      if (stopped) await accept.podStopped(stoppedPod, jsonHash({ controlledWholePodStop: stoppedPod }));
      releasable.push(await accept.releasable(original.podUid));
    },
  }, assertAvailable: async (project) => { if (deleting && project === f.project) throw precondition('controlled-project-deleting', { code: 'project_deletion_admission_closed' }); },
  assertGrant: async (context) => { await checkingGrant(); if (!permitted || context.operationId !== operationId || context.target.id !== f.project)
    throw precondition('controlled-runtime-grant-unavailable'); } };
  const work = runtimeProjectWork(f.database.db, sources, (error) => errors.push(error));
  const target = ProjectDeletionTargetSchema.parse({ id: f.project, serviceId: f.service, slug: 'controlled-runtime', name: 'Controlled runtime',
    namespace: 'cs-controlled-runtime', kind: 'DigitalWorker', state: 'deleting', revision: '1', prodHost: 'controlled.example', previewHost: 'preview.controlled.example', serviceHost: 'controlled.internal' });
  const context = async (phase: ProjectDeletionPhase = 'stop', generation = 1) => ProjectDeletionContextSchema.parse({ operationId, generation, phase, target, confirmed: (await f.inspect()).inventory });
  const seal = async (generation = 1) => withExclusiveDatabaseAdmission(f.database.db, runtimeProjectAdmissionKey(f.project), async (tx) => {
    await tx.execute(sql`SELECT set_config('crewstation.task_runtime_deletion_owner',${operationId + ':' + generation + ':seal'},true)`);
    await tx.execute(sql`INSERT INTO task_runtime.project_admissions(project_id,operation_id,generation,revision) VALUES(${f.project},${operationId},${generation},${jsonHash('controlled-seal')})
      ON CONFLICT(project_id) DO UPDATE SET generation=excluded.generation`);
  });
  const waitSeal = async () => {
    const deadline = Date.now() + 3000, key = runtimeProjectAdmissionKey(f.project);
    while (Date.now() < deadline) {
      const [state] = await f.database.db.execute<{ waiting: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND mode='ExclusiveLock' AND NOT granted
        AND classid=((hashtextextended(${key},0)>>32)&4294967295)::oid AND objid=(hashtextextended(${key},0)&4294967295)::oid AND objsubid=1) AS waiting`);
      if (state!.waiting) return; await Bun.sleep(10);
    }
    throw new Error('the original runtime exclusive admission did not start waiting');
  };
  const listener = await f.database.handle.client.listen('runtime_test_exit', (id) => { exits.add(id); waiters.get(id)?.(); waiters.delete(id); });
  await f.database.handle.client.unsafe(`CREATE FUNCTION task_runtime.notify_test_exit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.exited_at IS NOT NULL THEN PERFORM pg_notify('runtime_test_exit',NEW.id);END IF;RETURN NEW;END $$;
    CREATE TRIGGER runtime_test_exit AFTER UPDATE ON task_runtime.original_callbacks FOR EACH ROW EXECUTE FUNCTION task_runtime.notify_test_exit()`);
  const input = (projectId = f.project, parent = f.parent): RuntimeWorkInput => ({ projectId, originKind: 'task', originKey: parent,
    kind: 'task-api', reference: newResourceId(), inputDigest: jsonHash('controlled-runtime-request') });
  return { ...f, work, sources, target, original, errors, releasable, input, seal, waitSeal, context,
    stopped: (value: boolean) => { stopped = value; }, containerStopped: (value: boolean) => { containerStopped = value; },
    stopIdentity: (value: typeof stoppedPod) => { stoppedPod = value; }, protect: (value: typeof original) => { identity = value; },
    deleting: (value: boolean) => { deleting = value; }, permit: (value: boolean) => { permitted = value; }, checkingGrant: (value: typeof checkingGrant) => { checkingGrant = value; },
    waitExit: (id: string) => exits.has(id) ? Promise.resolve() : new Promise<void>((resolve) => { waiters.set(id, resolve); }),
    drop: async () => { await listener.unlisten(); await f.database.drop(); } };
}
