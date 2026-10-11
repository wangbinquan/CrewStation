// Actual PostgreSQL consumer/job/Controller with controlled digital owner and Kubernetes transport, no model usage or fabricated stop proof.
import { afterEach, describe, expect, test } from 'bun:test';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { Resources } from '@crewstation/k8s';
import { WORKLOAD_STOP_FINALIZER } from '@crewstation/contracts';
import { developmentPrestartCleanupFixture } from './developmentPrestartCleanupFixture';
import type { DevelopmentPrestartCleanupFixture } from './developmentPrestartCleanupFixture';

const available = await testDatabaseAvailable();
describe.skipIf(!available)('RFC-034 original scheduled/no-grant physical cleanup', () => {
  let f: DevelopmentPrestartCleanupFixture;
  afterEach(async () => { await f?.close(); });
  for (const marked of [true, false]) test('original ' + (marked ? 'marked' : 'legacy unmarked') + ' init waits for actual Controller proof and preserves unknown usage', async () => {
    f = await developmentPrestartCleanupFixture(marked); const original = await f.load(f.env.id);
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-admission', f.env.namespace)).toBeUndefined();
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    await f.runNative(); const prefix = await f.load(f.env.id);
    expect(prefix.native?.developmentCleanup).toMatchObject({ version: 2, phase: 'stopping', numericState: 'unknown', stopProof: null });
    expect(prefix.runnerTokenHash).toBe(original.runnerTokenHash); expect(prefix.native?.state).toBe('cleaning');
    expect((await f.k8s.get(Resources.Pod!, f.env.podName, f.env.namespace))?.metadata.finalizers).toContain(WORKLOAD_STOP_FINALIZER);
    expect((await f.safety.get(f.env.render!.workloadConsumerId!))?.stopProof).toBeNull();
    expect(f.physical.state.deleteRequests.filter((v) => v.startsWith('Secret:'))).toEqual([]);
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    await f.finalize(); const finished = await f.load(f.env.id), state = (await f.safety.get(f.env.render!.workloadConsumerId!))!;
    expect(finished.native?.state).toBe('finished'); expect(finished.native?.developmentCleanup).toMatchObject({ version: 2, phase: 'closed', numericState: 'unknown' });
    expect(state.startPermit).toBeNull(); expect(state.stopProof?.type).toBe('kubelet-terminated');
    expect(state.stopProof?.containers).toContainEqual(expect.objectContaining({ kind: 'init', state: 'terminated', containerId: 'containerd://original-init' }));
    expect(state.stopProof?.containers).toContainEqual(expect.objectContaining({ kind: 'container', state: 'never-started', containerId: null }));
    expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
    expect(f.physical.state.deleteRequests.filter((v) => v.startsWith('Secret:'))).toEqual(['Secret:' + f.env.podName + '-runner']);
    expect(await f.k8s.get(Resources.Pod!, f.parent.podName, f.parent.namespace)).toBeDefined();
    expect(JSON.stringify(finished.native?.developmentCleanup)).not.toContain('persistedThrough');
    await f.runNative(); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(1);
  }, 15_000);
  test('an unexpected admission Secret cannot consume a null permit or reclaim either credential', async () => {
    f = await developmentPrestartCleanupFixture();
    await f.k8s.create({ apiVersion: 'v1', kind: 'Secret', metadata: { name: f.env.podName + '-admission', namespace: f.env.namespace, uid: crypto.randomUUID() }, immutable: true });
    await f.runNative(); expect(f.physical.state.deleteRequests).toEqual([]); expect(await f.resources.api.occupancy(f.env.projectId)).toBe(2);
    expect(await f.k8s.get(Resources.Secret!, f.env.podName + '-runner', f.env.namespace)).toBeDefined();
  }, 15_000);
});
