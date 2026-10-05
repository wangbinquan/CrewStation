import { describe, expect, test } from 'bun:test';
import { ProjectDeletionContextSchema, TaskIdSchema } from '@crewstation/contracts';
import { LABELS, Resources } from '@crewstation/k8s';
import { jsonHash } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { kubernetesTaskCluster } from '../../adapters/k8s/taskCluster';
import { runtimeWorkModuleFixture } from './workModuleFixture';

const available = await testDatabaseAvailable();
/** Real factory, grants, SQL fences and private finally. Digital/container evidence is independently controlled. */
async function originalStopFixture(finishedChild = false) {
  const state = { digital: false, stopped: false, digitalCalls: 0, proofCalls: 0, volumeCalls: 0 };
  let child: string | undefined;
  const f = await runtimeWorkModuleFixture(async (original, k8s) => {
    if (finishedChild) child = await original.environment({ native: original.native() });
    return { cluster: { ...kubernetesTaskCluster(k8s, 10001),
    deleteVolume: async () => { state.volumeCalls++; throw new Error('STOP must retain the original volume'); } }, deletionStops: {
    development: () => ({ advance: async () => ({ kind: 'waiting', reason: 'controlled development digital source' }) }),
    digital: async () => { state.digitalCalls++; return state.digital ? { kind: 'ready' } : { kind: 'waiting', reason: 'controlled original digital copy' }; },
    stopped: async () => { state.proofCalls++; return state.stopped ? { digest: jsonHash('controlled independent whole-Pod stop') } : undefined; },
  } }; });
  await f.database.db.execute(sql`UPDATE task_runtime.environments SET state='running',volume_mode='follow-container',connected=true WHERE id=${f.parent}`);
  const env = (await f.module.api.getEnvironment(f.parent))!;
  const pod = await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: f.project, uid: crypto.randomUUID(), labels: { [LABELS.task]: f.parent } } });
  const pvc = await f.k8s.create({ apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: { name: 'work-' + f.parent, namespace: f.project, uid: crypto.randomUUID(), labels: { [LABELS.task]: f.parent } } });
  await f.database.db.execute(sql`UPDATE task_runtime.environments SET pod_uid=${pod.metadata.uid!} WHERE id=${f.parent}`);
  const owner = f.module.api.deletionOwner!, confirmed = await owner.inspect(f.target), base = await f.context();
  const context = (phase: 'seal' | 'stop') => ProjectDeletionContextSchema.parse({ ...base, phase, confirmed });
  expect((await owner.run(context('seal'))).kind).toBe('done');
  return { ...f, state, pod, pvc, owner, context, child };
}
describe.skipIf(!available)('production runtime STOP composition (actual PG/factory, controlled independent evidence)', () => {
  test('a missing original UID waits for independent history, then finishes an unstarted execution without a Pod DELETE', async () => {
    let proved = false, deletes = 0;
    const f = await runtimeWorkModuleFixture(async (_original, k8s) => ({ cluster: { ...kubernetesTaskCluster(k8s, 10001), deletePod: async () => { deletes++; throw Error('must not delete by name'); } },
      deletionStops: { development: () => ({ advance: async () => ({ kind: 'waiting', reason: 'unused development' }) }), digital: async () => ({ kind: 'ready' }), stopped: async () => proved ? { digest: jsonHash('controlled never-admitted independent history') } : undefined } }));
    try {
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET state='creating',pod_uid=NULL WHERE id=${f.parent}`);
      const owner = f.module.api.deletionOwner!, base = await f.context(), confirmed = await owner.inspect(f.target);
      const context = (phase: 'seal' | 'stop') => ProjectDeletionContextSchema.parse({ ...base, phase, confirmed });
      expect((await owner.run(context('seal'))).kind).toBe('done');
      expect((await owner.run(context('stop'))).kind).toBe('waiting'); expect(deletes).toBe(0);
      proved = true;
      expect((await owner.run(context('stop'))).kind).toBe('done'); expect(deletes).toBe(0);
      expect((await f.module.api.getEnvironment(f.parent))?.state).toBe('released');
      expect((await f.database.db.execute<{ pod_uid: string | null }>(sql`SELECT pod_uid FROM task_runtime.environments WHERE id=${f.parent}`))[0]?.pod_uid).toBeNull();
    } finally { await f.drop(); }
  });
  test('a legacy NULL UID uses the confirmed original UID; a same-name replacement is retained', async () => {
    let uid: string | undefined;
    const f = await runtimeWorkModuleFixture(async (_original, k8s) => ({ cluster: kubernetesTaskCluster(k8s, 10001), deletionStops: {
      development: () => ({ advance: async () => ({ kind: 'waiting', reason: 'unused development' }) }), digital: async () => ({ kind: 'ready' }), stopped: async () => undefined,
      originalPodUid: async () => uid,
    } }));
    try {
      await f.database.db.execute(sql`UPDATE task_runtime.environments SET state='running',pod_uid=NULL WHERE id=${f.parent}`);
      const env = (await f.module.api.getEnvironment(f.parent))!;
      const original = await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: f.project, uid: crypto.randomUUID() } }); uid = original.metadata.uid!;
      const owner = f.module.api.deletionOwner!, base = await f.context(), confirmed = await owner.inspect(f.target);
      const context = (phase: 'seal' | 'stop') => ProjectDeletionContextSchema.parse({ ...base, phase, confirmed });
      expect((await owner.run(context('seal'))).kind).toBe('done');
      await f.k8s.delete(Resources.Pod!, env.podName, f.project);
      const replacement = await f.k8s.create({ apiVersion: 'v1', kind: 'Pod', metadata: { name: env.podName, namespace: f.project, uid: crypto.randomUUID() } });
      await expect(owner.run(context('stop'))).rejects.toMatchObject({ kind: 'conflict' });
      expect((await f.k8s.get(Resources.Pod!, env.podName, f.project))?.metadata.uid).toBe(replacement.metadata.uid);
      expect((await f.database.db.execute<{ pod_uid: string | null }>(sql`SELECT pod_uid FROM task_runtime.environments WHERE id=${f.parent}`))[0]?.pod_uid).toBeNull();
    } finally { await f.drop(); }
  });
  test('digital copy precedes Pod DELETE; missing Pod alone cannot finish STOP; follow-container storage survives completion', async () => {
    const f = await originalStopFixture();
    try {
      expect(await f.owner.run(f.context('stop'))).toMatchObject({ kind: 'waiting' });
      expect(await f.k8s.get(Resources.Pod!, f.pod.metadata.name, f.project)).toBeDefined();
      expect((await f.module.api.getEnvironment(f.parent))?.state).toBe('running');
      f.state.digital = true;
      expect(await f.owner.run(f.context('stop'))).toMatchObject({ kind: 'waiting' });
      expect(await f.k8s.get(Resources.Pod!, f.pod.metadata.name, f.project)).toBeUndefined();
      expect((await f.module.api.getEnvironment(f.parent))?.state).toBe('releasing');
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.pvc.metadata.name, f.project))?.metadata.uid).toBe(f.pvc.metadata.uid);
      f.state.stopped = true;
      expect((await f.owner.run(f.context('stop'))).kind).toBe('done');
      expect((await f.module.api.getEnvironment(f.parent))?.state).toBe('released');
      expect((await f.module.api.getEnvironment(f.otherParent))?.state).toBe('released');
      expect(f.state.volumeCalls).toBe(0);
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.pvc.metadata.name, f.project))?.metadata.uid).toBe(f.pvc.metadata.uid);
      const callbacks = await f.work.history(f.project); expect(callbacks.length).toBeGreaterThan(0); expect(callbacks.every((row) => row.exited)).toBe(true);
      const calls = f.state.digitalCalls; expect((await f.owner.run(f.context('stop'))).kind).toBe('done'); expect(f.state.digitalCalls).toBe(calls);
      expect((await f.database.db.execute<{ body: { stopped: unknown } }>(sql`SELECT body FROM task_runtime.project_deletions WHERE project_id=${f.project}`))[0]!.body.stopped).not.toBeNull();
    } finally { await f.drop(); }
  });
  test('expired Root grants issue no digital or physical work and preserve the original Pod and volume', async () => {
    const f = await originalStopFixture();
    try {
      f.state.digital = true; f.state.stopped = true; f.permit(false);
      await expect(f.owner.run(f.context('stop'))).rejects.toMatchObject({ kind: 'precondition' });
      expect(f.state.digitalCalls).toBe(0); expect(f.state.proofCalls).toBe(0);
      expect((await f.k8s.get(Resources.Pod!, f.pod.metadata.name, f.project))?.metadata.uid).toBe(f.pod.metadata.uid);
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.pvc.metadata.name, f.project))?.metadata.uid).toBe(f.pvc.metadata.uid);
    } finally { await f.drop(); }
  });
  test('a finished historical execution still needs independent evidence but does not require a reclaimed queue delivery', async () => {
    const f = await originalStopFixture(true);
    try {
      f.state.digital = true;
      expect((await f.owner.run(f.context('stop'))).kind).toBe('waiting');
      expect((await f.module.api.getEnvironment(TaskIdSchema.parse(f.child)))?.native?.state).toBe('finished');
      f.state.stopped = true;
      expect((await f.owner.run(f.context('stop'))).kind).toBe('done');
      expect((await f.database.db.execute<{ count: number }>(sql`SELECT count(*)::integer AS count FROM platform_infra.jobs WHERE dedup_key=${f.child!}`))[0]?.count).toBe(0);
      expect(f.state.volumeCalls).toBe(0);
      expect((await f.k8s.get(Resources.PersistentVolumeClaim!, f.pvc.metadata.name, f.project))?.metadata.uid).toBe(f.pvc.metadata.uid);
    } finally { await f.drop(); }
  });
});
