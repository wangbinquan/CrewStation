import { describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { PROJECT_STOP_FINALIZER } from '../domain/deletion/podStop';
import { TARGET, deletionObject } from './projectDeletionFixture';
import { podProtectionFixture } from './projectPodProtectionFixture';

describe('只观测原 Pod 的停止状态（有状态 API Server 替身）', () => {
  test('活动 Pod 不发起删除，实际原 UID 删除和全部终止后先持久证明再释放自己的 finalizer', async () => {
    const f = await podProtectionFixture(); await f.plan(); await f.source.seal(f.context('seal'));
    expect(await f.source.observeTerminating(f.context('stop'))).toBeUndefined(); expect(f.calls).toHaveLength(0);
    expect(f.receipts.size).toBe(0); expect((await f.read())!.metadata.finalizers).toContain(PROJECT_STOP_FINALIZER);
    await f.k8s.delete(Resources.Pod!, 'original', TARGET.namespace, { preconditions: { uid: 'original-pod' }, propagationPolicy: 'Foreground' });
    await f.source.observeTerminating(f.context('stop')); expect(f.calls).toEqual(['delete']); expect(f.receipts.size).toBe(0);
    await f.terminate(); f.failProofStore(true); await expect(f.source.observeTerminating(f.context('stop'))).rejects.toThrow('proof store unavailable');
    expect((await f.read())!.metadata.finalizers).toContain(PROJECT_STOP_FINALIZER);
    f.failProofStore(false); expect(await f.source.observeTerminating(f.context('stop'))).toBeUndefined();
    expect(f.calls.slice(-2)).toEqual(['save', 'release']); expect(f.receipts.size).toBe(1);
    expect((await f.read())!.metadata.finalizers).toEqual(['external.test/retain']);
    const calls = [...f.calls]; await f.source.observeTerminating(f.context('stop')); expect(f.calls).toEqual(calls);
  });
  test('前面的原 Pod 仍活动也继续观测后面的原终结 Pod，避免停止保护等待形成环', async () => {
    const f = await podProtectionFixture(), original = (await f.read())!;
    await f.put(deletionObject('Pod', 'second', { metadata: { name: 'second', namespace: TARGET.namespace, uid: 'second-pod', finalizers: ['external.test/retain'] }, spec: original['spec'], status: original['status'] }));
    const report = await f.plan(); expect(JSON.parse(report.resources[0]!.id).name).toBe('original');
    await f.source.seal(f.context('seal')); await f.terminate(); const ended = (await f.read())!['status'];
    await f.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { status: { phase: 'Running' } });
    await f.k8s.delete(Resources.Pod!, 'second', TARGET.namespace, { preconditions: { uid: 'second-pod' }, propagationPolicy: 'Foreground' });
    await f.k8s.mergePatch(Resources.Pod!, 'second', TARGET.namespace, { status: ended });
    await f.source.observeTerminating(f.context('stop'));
    expect(f.calls).toEqual(['delete', 'save', 'release']); expect(f.receipts.size).toBe(1);
    expect([...f.receipts.values()][0]!.uid).toBe('second-pod');
    expect((await f.read())!.metadata.deletionTimestamp).toBeUndefined(); expect((await f.read())!.metadata.finalizers).toContain(PROJECT_STOP_FINALIZER);
    expect((await f.k8s.get(Resources.Pod!, 'second', TARGET.namespace))!.metadata.finalizers).toEqual(['external.test/retain']);
  });
  test('阶段、原实例和当前许可变化均拒绝观测副作用，不能用替换实例补证明', async () => {
    const f = await podProtectionFixture(); await f.plan(); await f.source.seal(f.context('seal'));
    await expect(f.source.observeTerminating(f.context('prove'))).rejects.toThrow('阶段');
    const original = (await f.read())!; await f.forget(); await f.put({ ...original, metadata: { ...original.metadata, uid: 'replacement' } });
    await expect(f.source.observeTerminating(f.context('stop'))).rejects.toThrow('替换'); expect(f.calls).toHaveLength(0);
    const taken = await podProtectionFixture(); await taken.plan(); await taken.source.seal(taken.context('seal')); taken.takeover();
    await expect(taken.source.observeTerminating(taken.context('stop'))).rejects.toThrow('失效'); expect(taken.calls).toHaveLength(0); expect(taken.receipts.size).toBe(0);
  });
});
