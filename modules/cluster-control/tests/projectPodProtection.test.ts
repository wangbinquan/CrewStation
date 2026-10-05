import { describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { PROJECT_STOP_ANNOTATION, PROJECT_STOP_FINALIZER } from '../domain/deletion/podStop';
import { TARGET, deletionObject } from './projectDeletionFixture';
import { podProtectionFixture } from './projectPodProtectionFixture';

describe('原项目 Pod 保护与物理停止（有状态 API Server 替身）', () => {
  test('selected build consumers use the complete original grant and preserve every other protected Pod', async () => {
    const f = await podProtectionFixture(false);
    await f.put(deletionObject('Pod', 'other', { spec: { containers: [{ name: 'other' }] } }));
    const plan = await f.plan(); expect(plan.resources).toHaveLength(2);
    const original = plan.resources.find(row => JSON.parse(row.id).name === 'original')!;
    await f.source.seal(f.context('seal'));
    const before = (await f.k8s.get(Resources.Pod!, 'other', TARGET.namespace))!;
    await expect(f.source.stopSelected(f.context('stop'), ['unknown'])).rejects.toThrow('确认范围');
    await expect(f.source.stopSelected(f.context('stop'), [original.id, original.id])).rejects.toThrow('确认范围');
    expect(f.calls).not.toContain('delete');
    expect(await f.source.stopSelected(f.context('stop'), [original.id])).toMatchObject({ kind: 'done', evidence: { kind: 'physical', count: 1 } });
    const after = (await f.k8s.get(Resources.Pod!, 'other', TARGET.namespace))!;
    expect(after).toEqual(before); expect(f.receipts.size).toBe(1);
    expect(f.context('stop').confirmed.resources).toEqual(plan.resources);
    expect(await f.source.stopSelected(f.context('stop'), [])).toMatchObject({ kind: 'done', evidence: { count: 0 } });
  });
  test('原节点、普通/init/临时容器皆有终止证明且持久 ACK 后，才释放自己的保护', async () => {
    const f = await podProtectionFixture(); const report = await f.plan();
    expect(report.resources).toHaveLength(1); expect(JSON.stringify(report)).not.toContain('Running');
    expect((await f.source.seal(f.context('seal'))).kind).toBe('done');
    expect((await f.read())!.metadata.annotations).toMatchObject({ [PROJECT_STOP_ANNOTATION]: f.context('seal').operationId, 'external.test/key': 'keep' });
    expect((await f.read())!.metadata.finalizers).toEqual(['external.test/retain', PROJECT_STOP_FINALIZER]);
    expect(await f.source.stop(f.context('stop'))).toMatchObject({ kind: 'waiting' }); expect(f.receipts.size).toBe(0);
    await f.terminate(); f.failProofStore(true); await expect(f.source.stop(f.context('stop'))).rejects.toThrow('proof store unavailable');
    expect((await f.read())!.metadata.finalizers).toContain(PROJECT_STOP_FINALIZER);
    f.failProofStore(false); expect((await f.source.stop(f.context('stop'))).kind).toBe('done');
    expect(f.calls.slice(-2)).toEqual(['save', 'release']); expect((await f.read())!.metadata.finalizers).toEqual(['external.test/retain']);
    expect(await f.source.verify(f.context('prove'))).toMatchObject({ kind: 'waiting' });
    await f.forget(); expect(await f.source.stop(f.context('stop'))).toMatchObject({ kind: 'done', evidence: { kind: 'physical' } });
    expect(await f.source.verify(f.context('verify'))).toMatchObject({ kind: 'done', evidence: { kind: 'physical' } });
  });
  test('陈旧节点、节点换 UID、NodeLost、缺一个容器状态，均不能确认停止', async () => {
    const f = await podProtectionFixture(); await f.plan(); await f.source.seal(f.context('seal')); await f.source.stop(f.context('stop')); await f.terminate();
    f.advance(45_000); expect((await f.source.stop(f.context('stop'))).kind).toBe('waiting'); await f.heartbeat();
    await f.k8s.mergePatch(Resources.Node!, 'worker', undefined, { metadata: { uid: 'replacement-node' } }); expect((await f.source.stop(f.context('stop'))).kind).toBe('waiting');
    await f.k8s.mergePatch(Resources.Node!, 'worker', undefined, { metadata: { uid: 'original-node' } });
    await f.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { status: { reason: 'NodeLost' } }); expect((await f.source.stop(f.context('stop'))).kind).toBe('waiting');
    await f.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { status: { reason: null, ephemeralContainerStatuses: [] } }); expect((await f.source.stop(f.context('stop'))).kind).toBe('waiting'); expect(f.receipts.size).toBe(0);
  });
  test('原实例 API 消失、同名换 UID、许可换世代、新 Pod 和 CAS 竞争均阻断，不修改替代实例', async () => {
    const f = await podProtectionFixture(); await f.plan(); await f.source.seal(f.context('seal')); await f.forget();
    await expect(f.source.stop(f.context('stop'))).rejects.toThrow('不存在不能替代');
    await f.put(deletionObject('Pod', 'original', { metadata: { name: 'original', namespace: TARGET.namespace, uid: 'replacement' }, spec: { containers: [{ name: 'x' }] } }));
    const changes = f.k8s.applied.length; await expect(f.source.stop(f.context('stop'))).rejects.toThrow('替换'); expect(f.k8s.applied).toHaveLength(changes);
    f.takeover(); await expect(f.source.seal(f.context('seal'))).rejects.toThrow('失效');
    const fresh = await podProtectionFixture(false); await fresh.plan();
    const patch = fresh.k8s.jsonPatch.bind(fresh.k8s); fresh.k8s.jsonPatch = async (ref, name, ns, changes) => { await fresh.k8s.mergePatch(ref, name, ns, { metadata: { resourceVersion: 'raced' } }); return patch(ref, name, ns, changes); };
    await expect(fresh.source.seal(fresh.context('seal'))).rejects.toMatchObject({ kind: 'conflict' }); expect((await fresh.read())!.metadata.finalizers).not.toContain(PROJECT_STOP_FINALIZER);
  });
  test('从未调度的原 Pod 也先关闭准入和删除，再保存从未启动证明；新增对象复盘阻断', async () => {
    const f = await podProtectionFixture(false); await f.plan();
    await expect(f.source.seal(f.context('stop'))).rejects.toThrow('阶段');
    await f.source.seal(f.context('seal')); expect((await f.source.stop(f.context('stop'))).kind).toBe('done'); expect(f.receipts.values().next().value?.nodeUid).toBeNull(); await f.forget();
    await f.put(deletionObject('Pod', 'late', { spec: { containers: [{ name: 'late' }] } }));
    expect(await f.source.verify(f.context('verify'))).toMatchObject({ kind: 'blocked', blockers: [{ code: 'new-pod' }] });
  });
  test('丢失保护或改变配置时，在任何删除副作用之前拒绝，避免主动造成停止证据丢失', async () => {
    const f = await podProtectionFixture(); await f.plan(); await f.source.seal(f.context('seal'));
    await f.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { metadata: { finalizers: ['external.test/retain'] } });
    await expect(f.source.stop(f.context('stop'))).rejects.toThrow('保护不完整'); expect(f.calls).not.toContain('delete');
    const changed = await podProtectionFixture(); await changed.plan(); await changed.source.seal(changed.context('seal'));
    await changed.k8s.mergePatch(Resources.Pod!, 'original', TARGET.namespace, { spec: { ephemeralContainers: [{ name: 'new-debug' }] } });
    await expect(changed.source.stop(changed.context('stop'))).rejects.toThrow('配置'); expect(changed.calls).not.toContain('delete');
  });
});
