// RFC-034: Resources admission and Task parent projection share the same parent row lock.
import { afterEach, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import type { Database, Executor } from '@crewstation/persistence';
import type { WorkloadConsumer } from '@crewstation/contracts';
import { TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { workloadSafetyRepository } from '../adapters/persistence/safety/repository';
import type { Harness } from './fixtures';
import { createHarness, PROJECT, workspace } from './fixtures';

function latch() {
  let entered!: () => void, resume!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const release = new Promise<void>((resolve) => { resume = resolve; });
  return { entered, resume, ready, release };
}
function namedDatabase(db: Database, name: string, hold?: ReturnType<typeof latch>): Database {
  return new Proxy(db, { get(target, key, receiver) {
    if (key !== 'transaction') return Reflect.get(target, key, receiver);
    return (run: (tx: Executor) => Promise<unknown>) => target.transaction(async (tx) => {
      await tx.execute(sql`select set_config('application_name', ${name}, true)`);
      const result = await run(tx);
      if (hold) { hold.entered(); await hold.release; }
      return result;
    });
  } });
}
async function waitForRowLock(db: Database, name: string, settled: () => boolean = () => false) {
  for (let i = 0; i < 60; i += 1) {
    const [row] = await db.execute(sql`select exists(select 1 from pg_stat_activity where application_name=${name} and wait_event_type='Lock') as waiting`);
    if (row?.waiting === true) return true;
    if (settled()) return false;
    await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
  }
  return false;
}
async function seal(db: Database, parentId: string, name: string, hold?: ReturnType<typeof latch>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('application_name', ${name}, true)`);
    await tx.execute(sql`select id from resources.records where id=${parentId} for update`);
    await tx.execute(sql`update resources.records set spec=jsonb_set(spec,'{developmentParentEnding}','{"version":1}'::jsonb,true), generation=generation+1, version=version+1 where id=${parentId}`);
    if (hold) { hold.entered(); await hold.release; }
  });
}

const available = await testDatabaseAvailable();
describe.skipIf(!available)('development parent common Resources admission fence', () => {
  let h: Harness;
  afterEach(async () => { await h?.database.drop(); });
  async function fixture(observed = true, selectedReceipt = false) {
    h = await createHarness();
    const owner = h.module.api.owner('task-runtime'), parentId = TaskIdSchema.parse(newResourceId()), childId = newResourceId();
    const parentUid = crypto.randomUUID(), volumeUid = crypto.randomUUID(), childUid = crypto.randomUUID();
    const parent = await owner.declare(workspace(parentId, { id: parentId }));
    const volume = await owner.declare({ kind: 'volume', ref: parentId + '/work', projectId: PROJECT, parentId, spec: { children: [{ kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: 'original-work' }] } });
    const consumer: WorkloadConsumer = { id: newResourceId(), taskId: parentId, resourceId: childId, namespace: 'cs-demo', podName: 'original-agent', revision: 1, purpose: 'agent', finalization: null, volumeUid };
    const { resourceId: _resource, namespace: _namespace, podName: _pod, volumeUid: _volume, ...intent } = consumer;
    const pod = { image: 'task@sha256:original', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo',
      pvc: 'original-work', secret: 'original-agent-runner', developmentUsageStorage: { version: 1 }, developmentUsageProtection: { version: 1 },
      ...(selectedReceipt ? { developmentRemovalProtection: { version: 1 } } : {}),
      expectedVolumeUid: volumeUid, consumer: intent, nodeName: 'original-node', workspace: { pod: 'task-' + parentId, podUid: parentUid, pvcUid: volumeUid },
      labels: { 'crewstation.io/workspace-task': parentId }, annotations: { 'crewstation.io/cli-intent': 'a'.repeat(64) } };
    const declaration = { id: childId, kind: 'agent-execution' as const, ref: childId, projectId: PROJECT, parentId, purpose: 'development-agent' as const,
      spec: { children: [{ kind: 'Pod', namespace: 'cs-demo', name: consumer.podName }, { kind: 'Secret', namespace: 'cs-demo', name: pod.secret }, { kind: 'Secret', namespace: 'cs-demo', name: consumer.podName + '-admission' }], workloadConsumerId: consumer.id, pod } };
    await owner.declare(declaration);
    const observe = async () => {
      await h.module.api.observe({ resourceId: parent.id, child: { kind: 'Pod', namespace: 'cs-demo', name: pod.workspace.pod, uid: parentUid, phase: 'Running', ready: true, node: 'original-node' } });
      await h.module.api.observe({ resourceId: volume.id, child: { kind: 'PersistentVolumeClaim', namespace: 'cs-demo', name: pod.pvc, uid: volumeUid, phase: 'Bound', ready: true } });
    };
    if (observed) await observe();
    const bind = () => owner.declare({ ...declaration, spec: { ...declaration.spec, pod: { ...pod, expectedPodUid: childUid } } });
    return { owner, parent, volume, consumer, pod, declaration, observe, bind, safety: h.module.api.workloadSafety, permit: { podUid: childUid, nodeName: 'original-node', nodeUid: crypto.randomUUID() } };
  }

  test.each(['register', 'grantStart'] as const)('%s locks the parent until admission commits; seal waits and subsequent replay is rejected', async (operation) => {
    const f = await fixture(); await f.bind();
    if (operation === 'grantStart') await f.safety.register(f.consumer);
    const gate = latch(), safety = workloadSafetyRepository(namedDatabase(h.database.db, 'admission-' + newResourceId(), gate));
    const admission = operation === 'register' ? safety.register(f.consumer) : safety.grantStart(f.consumer.id, f.permit);
    await gate.ready;
    const name = 'ending-' + newResourceId(), ending = seal(h.database.db, f.parent.id, name);
    let blocked = false;
    try { blocked = await waitForRowLock(h.database.db, name); } finally { gate.resume(); }
    const saved = await admission; await ending;
    expect(blocked).toBe(true);
    expect(saved.consumer).toEqual(f.consumer);
    if (operation === 'grantStart') expect(saved.startPermit).toMatchObject(f.permit);
    await expect(f.safety.register(f.consumer)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
  });
  test.each(['register', 'grantStart'] as const)('seal first: %s waits for the actual parent row then rejects the sealed snapshot', async (operation) => {
    const f = await fixture(); await f.bind();
    if (operation === 'grantStart') await f.safety.register(f.consumer);
    const gate = latch(), ending = seal(h.database.db, f.parent.id, 'ending-' + newResourceId(), gate);
    await gate.ready;
    const name = 'late-admission-' + newResourceId(), safety = workloadSafetyRepository(namedDatabase(h.database.db, name));
    const attempt = operation === 'register' ? safety.register(f.consumer) : safety.grantStart(f.consumer.id, f.permit);
    let settled = false;
    const outcome = attempt.then((value) => { settled = true; return { value, error: undefined }; }, (error: unknown) => { settled = true; return { value: undefined, error }; });
    let blocked = false;
    try { blocked = await waitForRowLock(h.database.db, name, () => settled); } finally { gate.resume(); }
    await ending; const result = await outcome;
    expect(blocked).toBe(true);
    expect(result.error).toMatchObject({ details: { code: 'workload_admission_closed' } });
    expect((await f.safety.get(f.consumer.id))?.startPermit ?? null).toBeNull();
    expect((await h.module.api.get(f.parent.id))?.desired).toBe('present');
  });
  test.each([null, false, { invalid: true }])('malformed ending presence never downgrades open replay or a fresh registration', async (selection) => {
    const f = await fixture(); await f.safety.register(f.consumer); await f.bind();
    await h.database.db.execute(sql`update resources.records set spec=jsonb_set(spec,'{developmentParentEnding}',${JSON.stringify(selection)}::jsonb,true), version=version+1 where id=${f.parent.id}`);
    await expect(f.safety.register(f.consumer)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await expect(f.safety.register({ ...f.consumer, id: newResourceId() })).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
    expect((await f.safety.get(f.consumer.id))?.startPermit).toBeNull();
  });
  test('a closed historical consumer remains readable after the parent is sealed', async () => {
    const f = await fixture(); await f.safety.register(f.consumer); await f.bind(); await f.safety.grantStart(f.consumer.id, f.permit);
    const closed = await f.safety.closeConsumer(f.consumer.id);
    await seal(h.database.db, f.parent.id, 'ending-' + newResourceId());
    expect(await f.safety.register(f.consumer)).toEqual(closed);
    expect(await f.safety.get(f.consumer.id)).toEqual(closed);
    await expect(f.safety.grantStart(f.consumer.id, f.permit)).rejects.toMatchObject({ details: { code: 'workload_admission_closed' } });
  });
});
