import { describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { TARGET } from './projectDeletionFixture';
import { volumeReclamationFixture } from './projectVolumeReclamationFixture';

describe('原项目卷独立销毁许可与供应器回收（有状态来源替身）', () => {
  test('原供应器在删除之前持久固定，CSI 只剩删除请求或 PV 时一直等待，直到原后端删除回执', async () => {
    const f = await volumeReclamationFixture(), report = await f.plan();
    expect(report.complete).toBe(true); expect(report.resources).toHaveLength(1); expect(JSON.stringify(report)).not.toContain('secret-provider-handle');
    expect((await f.source.seal(f.context('seal'))).kind).toBe('done'); expect(f.calls).toEqual(['pin']);
    expect((await f.source.purge(f.context('purge'))).kind).toBe('waiting'); expect(f.rows.values().next().value?.digest).toBeNull();
    expect((await f.source.prove(f.context('prove'))).kind).toBe('waiting');
    await f.backendGone(); expect((await f.source.purge(f.context('purge'))).kind).toBe('done');
    expect((await f.source.prove(f.context('prove'))).kind).toBe('done'); expect((await f.source.verify(f.context('verify'))).kind).toBe('done');
    expect(f.calls).toEqual(['pin', 'proof']);
  });
  test('Pending 原 PVC 等首次供给绑定，固定实际 PV 后继续同操作；从不以尚无 PV 冒充回收', async () => {
    const f = await volumeReclamationFixture(true); await f.plan(); await f.source.seal(f.context('seal'));
    expect((await f.source.purge(f.context('purge'))).kind).toBe('waiting'); expect(f.k8s.deleted).toHaveLength(0);
    await f.bind(); expect((await f.source.purge(f.context('purge'))).kind).toBe('waiting'); expect(f.calls).toEqual(['pin']);
    await f.backendGone(); expect((await f.source.purge(f.context('purge'))).kind).toBe('done'); expect((await f.source.verify(f.context('verify'))).kind).toBe('done');
  });
  test('同名 PVC/PV 换 UID、Retain、丢 finalizer、旧租约和读错误均停止销毁或证明', async () => {
    const f = await volumeReclamationFixture(); await f.plan(); await f.source.seal(f.context('seal'));
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', TARGET.namespace, { metadata: { uid: 'replacement' } });
    await expect(f.source.purge(f.context('purge'))).rejects.toThrow('替换'); expect(f.k8s.deleted).toHaveLength(0);
    await f.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', TARGET.namespace, { metadata: { uid: 'original-pvc' } });
    await f.k8s.mergePatch(Resources.PersistentVolume!, 'original-pv', undefined, { spec: { persistentVolumeReclaimPolicy: 'Retain' } });
    await expect(f.source.purge(f.context('purge'))).rejects.toThrow(); expect(f.k8s.deleted).toHaveLength(0);
    f.takeover(); await expect(f.source.purge(f.context('purge'))).rejects.toThrow('失效');
    const other = await volumeReclamationFixture(); await other.plan(); await other.source.seal(other.context('seal')); await other.source.purge(other.context('purge'));
    await other.k8s.mergePatch(Resources.PersistentVolume!, 'original-pv', undefined, { metadata: { uid: 'replacement-pv' } }); await expect(other.source.purge(other.context('purge'))).rejects.toThrow('替代资源');
  });
  test('local-path 还须认证探针确认原节点目录不存在；元数据空不掩盖底层目录残留', async () => {
    const f = await volumeReclamationFixture(false, true); await f.plan(); await f.source.seal(f.context('seal'));
    await f.source.purge(f.context('purge')); await f.backendGone(); f.physicalAbsent(false);
    expect((await f.source.purge(f.context('purge'))).kind).toBe('waiting'); expect(f.rows.values().next().value?.digest).toBeNull();
    f.physicalAbsent(true); expect((await f.source.purge(f.context('purge'))).kind).toBe('done'); expect(f.calls).toContain('physical-probe');
    f.physicalAbsent(false); expect((await f.source.verify(f.context('verify'))).kind).toBe('waiting');
  });
  test('原 PVC 已消失仍盘点固定来源，失败 discovery 不制造空盘点或删除新仓', async () => {
    const f = await volumeReclamationFixture(); await f.plan(); await f.source.seal(f.context('seal')); const target = f.rows.values().next().value!.target;
    f.known.push(target); await f.source.purge(f.context('purge')); await f.backendGone();
    f.admission.ownsVolume = async (_id, volume) => volume.metadata.uid === target.pvUid;
    const inventory = await f.source.inspect(TARGET); expect(inventory.resources).toHaveLength(1); expect(JSON.parse(inventory.resources[0]!.identity).target).toEqual(target);
    f.k8s.namespacedResources = async () => { throw new Error('discovery unavailable'); }; await expect(f.source.inspect(TARGET)).rejects.toThrow('discovery unavailable');
  });
});
