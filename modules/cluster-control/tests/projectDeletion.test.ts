import { describe, expect, test } from 'bun:test';
import { Resources } from '@crewstation/k8s';
import { clusterDeletionFixture, deletionObject, TARGET } from './projectDeletionFixture';

describe('永久删除的集群 owner（真实适配器／假 API Server）', () => {
  test('全 discovery 和分页含无标签对象、远端 PV；名字认领不能授权替换 UID', async () => {
    const fixture = await clusterDeletionFixture();
    await fixture.put(deletionObject('PersistentVolumeClaim', 'work', { spec: { volumeName: 'pv-work' } }));
    await fixture.k8s.create(deletionObject('PersistentVolume', 'pv-work', { spec: { claimRef: { namespace: TARGET.namespace, name: 'work', uid: 'uid-PersistentVolumeClaim-work' } } }));
    await fixture.k8s.create(deletionObject('Secret', 'manual'));
    const report = await fixture.plan();
    expect(report.complete).toBe(true); expect(report.resources.map((entry) => entry.kind)).toContain('PersistentVolume');
    expect(report.blockers.map((entry) => entry.resourceId)).toEqual(['manual']);
    await fixture.k8s.delete(Resources.Secret!, 'manual', TARGET.namespace);
    await fixture.k8s.mergePatch(Resources.PersistentVolumeClaim!, 'work', TARGET.namespace, { metadata: { uid: 'replacement' } });
    expect((await fixture.plan()).blockers.map((entry) => entry.resourceId)).toContain('work');
    fixture.k8s.namespacedResources = async () => [Resources.Secret!];
    const list = fixture.k8s.listPage.bind(fixture.k8s); let pages = 0;
    fixture.k8s.listPage = async (ref, ns, options) => ref.kind === 'Secret' ? (pages++, { items: options?.continue ? [deletionObject('Secret', 'last-page')] as never : [], resourceVersion: '1', continue: options?.continue ? '' : 'next' }) : list(ref, ns, options);
    expect((await fixture.plan()).blockers.map((entry) => entry.resourceId)).toContain('last-page'); expect(pages).toBe(2);
  });
  test('控制器子对象只经原 owner UID 链认领；未知 CRD、外部项目和无法发现来源阻断', async () => {
    const fixture = await clusterDeletionFixture();
    await fixture.put(deletionObject('Deployment', 'worker'));
    await fixture.k8s.create(deletionObject('ReplicaSet', 'worker-rs', { metadata: { name: 'worker-rs', namespace: TARGET.namespace, uid: 'rs-uid', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'Deployment', name: 'worker', uid: 'uid-Deployment-worker', controller: true }] } }));
    await fixture.k8s.create(deletionObject('Pod', 'worker-pod', { metadata: { name: 'worker-pod', namespace: TARGET.namespace, uid: 'pod-uid', ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'worker-rs', uid: 'rs-uid', controller: true }] } }));
    expect((await fixture.plan()).blockers).toEqual([]);
    await fixture.k8s.mergePatch(Resources.Pod!, 'worker-pod', TARGET.namespace, { metadata: { ownerReferences: [{ apiVersion: 'apps/v1', kind: 'ReplicaSet', name: 'worker-rs', uid: 'foreign-uid', controller: true }] } });
    expect((await fixture.plan()).blockers.map((entry) => entry.resourceId)).toContain('worker-pod');
    fixture.k8s.namespacedResources = async () => { throw new Error('discovery unavailable'); };
    await expect(fixture.plan()).rejects.toThrow('discovery unavailable');
    delete fixture.k8s.namespacedResources;
    await expect(fixture.plan()).rejects.toThrow('discovery');
  });
  test('封闭后原工作负载和 PV 尚在均等待；命名空间终结请求不提前显示成功', async () => {
    const fixture = await clusterDeletionFixture();
    await fixture.put(deletionObject('Pod', 'work'));
    await fixture.put(deletionObject('Service', 'idle'));
    await fixture.put(deletionObject('PersistentVolumeClaim', 'volume'));
    await fixture.k8s.create(deletionObject('PersistentVolume', 'pv', { spec: { claimRef: { namespace: TARGET.namespace, uid: 'uid-PersistentVolumeClaim-volume' } } }));
    await fixture.plan(); expect((await fixture.run('seal')).kind).toBe('done');
    expect((await fixture.run('stop')).kind).toBe('waiting');
    await fixture.k8s.delete(Resources.Pod!, 'work', TARGET.namespace);
    expect((await fixture.run('stop')).kind).toBe('done'); expect((await fixture.run('prove')).kind).toBe('waiting');
    await fixture.k8s.delete(Resources.PersistentVolumeClaim!, 'volume', TARGET.namespace);
    expect((await fixture.run('prove')).kind).toBe('blocked'); // 原 PVC 已没，PV 仍在且无原卷身份能力，不能装成零。
    await fixture.k8s.delete(Resources.PersistentVolume!, 'pv');
    expect((await fixture.run('prove')).kind).toBe('done');
    const deletion = fixture.k8s.delete.bind(fixture.k8s); let sent = 0;
    fixture.k8s.delete = async (ref, name, ns, options) => {
      if (ref.kind !== 'Namespace') return deletion(ref, name, ns, options);
      sent++; expect(options?.preconditions?.uid).toBe('uid-Namespace-' + TARGET.namespace);
      await fixture.k8s.mergePatch(ref, name, ns, { metadata: { deletionTimestamp: new Date().toISOString(), finalizers: ['custom.example/retain'] } }); return true;
    };
    expect((await fixture.run('namespace')).kind).toBe('waiting'); expect(sent).toBe(1);
    expect((await fixture.run('namespace')).kind).toBe('waiting'); expect(sent).toBe(1);
    expect((await fixture.k8s.get(Resources.Namespace!, TARGET.namespace))?.metadata.finalizers).toEqual(['custom.example/retain']);
    await deletion(Resources.Namespace!, TARGET.namespace); expect((await fixture.run('namespace')).kind).toBe('done');
    expect((await fixture.run('verify')).kind).toBe('waiting');
    await deletion(Resources.Service!, 'idle', TARGET.namespace); expect((await fixture.run('verify')).kind).toBe('done');
  });
  test('盘点后的新 UID、未知资源、旧租约和系统命名空间均无删除副作用', async () => {
    const fixture = await clusterDeletionFixture(); await fixture.plan();
    fixture.revoke(); await expect(fixture.run('seal')).rejects.toThrow('失效'); expect(fixture.sealed()).toBe(false);
    const fresh = await clusterDeletionFixture(); await fresh.plan(); await fresh.run('seal');
    fresh.takeover(); await expect(fresh.run('namespace', { generation: 1 })).rejects.toThrow('失效'); expect(fresh.removed).toEqual([]);
    await fresh.k8s.mergePatch(Resources.Namespace!, TARGET.namespace, undefined, { metadata: { uid: 'new-namespace' } });
    expect((await fresh.run('namespace')).kind).toBe('blocked'); expect(fresh.removed).toEqual([]);
    const newObject = await clusterDeletionFixture(); await newObject.plan(); await newObject.run('seal');
    await newObject.k8s.create(deletionObject('Secret', 'late'));
    expect((await newObject.run('namespace')).kind).toBe('blocked'); expect(newObject.removed).toEqual([]);
    for (const namespace of ['crewstation-system', 'default', 'kube-system']) await expect(newObject.owner.inspect({ ...TARGET, namespace })).rejects.toThrow('系统命名空间');
  });
  test('分页循环与读取失败不签发空证明；重新确认前的修订变化先封再阻断', async () => {
    const fixture = await clusterDeletionFixture(); await fixture.plan();
    await fixture.put(deletionObject('Service', 'late-service'));
    expect((await fixture.run('seal')).kind).toBe('blocked'); expect(fixture.sealed()).toBe(true); expect(fixture.removed).toEqual([]);
    fixture.k8s.listPage = async () => ({ items: [], resourceVersion: '1', continue: 'stuck' });
    await expect(fixture.plan()).rejects.toThrow('分页');
    fixture.k8s.listPage = async () => { throw new Error('forbidden'); };
    await expect(fixture.run('prove')).rejects.toThrow('forbidden'); expect(fixture.removed).toEqual([]);
  });
});
test('原 Pending PVC 首次供给的 PV 可进入同操作等待；已确认 PV 替换和已固定供应器的不符对象仍阻断', async () => {
  const f = await clusterDeletionFixture(); await f.put(deletionObject('PersistentVolumeClaim', 'pending', { spec: {} }));
  await f.plan(); await f.run('seal');
  const pvc = await f.k8s.get(Resources.PersistentVolumeClaim!, 'pending', TARGET.namespace);
  await f.k8s.create(deletionObject('PersistentVolume', 'late-pv', { spec: { claimRef: { namespace: TARGET.namespace, uid: pvc!.metadata.uid } } }));
  expect((await f.run('prove')).kind).toBe('waiting');
  f.admission.ownsVolume = async () => false;
  expect(await f.run('prove')).toMatchObject({ kind: 'blocked', blockers: [{ code: 'unknown-object' }] });
});

test('原路由、中间件和凭据按原 UID 回收；已完成 purge 的同操作在 prove 收敛，ACK 不冒充完成', async () => {
  const f = await clusterDeletionFixture();
  for (const kind of ['IngressRoute', 'Middleware', 'Secret']) await f.put(deletionObject(kind, 'original'));
  await f.put(deletionObject('Service', 'idle'));
  await f.plan(); await f.run('seal'); expect((await f.run('stop')).kind).toBe('done');
  const remove = f.k8s.delete.bind(f.k8s); let acknowledgements = 0;
  f.k8s.delete = async (ref, name, namespace, options) => {
    if (ref.kind !== 'IngressRoute') return remove(ref, name, namespace, options);
    acknowledgements++; expect(options?.preconditions?.uid).toBe('uid-IngressRoute-original');
    await f.k8s.mergePatch(ref, name, namespace, { metadata: { deletionTimestamp: new Date().toISOString(), finalizers: ['example.test/retain'] } }); return true;
  };
  expect((await f.run('prove')).kind).toBe('waiting');
  expect(acknowledgements).toBe(1);
  expect(await f.k8s.get(Resources.Middleware!, 'original', TARGET.namespace)).toBeUndefined();
  expect(await f.k8s.get(Resources.Secret!, 'original', TARGET.namespace)).toBeUndefined();
  expect(await f.k8s.get(Resources.Service!, 'idle', TARGET.namespace)).toBeDefined();
  expect(f.removed).not.toContain('Namespace/' + TARGET.namespace);
  expect((await f.run('prove')).kind).toBe('waiting'); expect(acknowledgements).toBe(1);
  expect((await f.k8s.get(Resources.IngressRoute!, 'original', TARGET.namespace))?.metadata.finalizers).toEqual(['example.test/retain']);
  await remove(Resources.IngressRoute!, 'original', TARGET.namespace);
  expect((await f.run('prove')).kind).toBe('done');
});

test('purge 清理原网关实体，未知对象及同名替换阻断全部写入；封闭准入和当前许可每次仍须成立', async () => {
  const f = await clusterDeletionFixture(); await f.put(deletionObject('IngressRoute', 'original')); await f.plan(); await f.run('seal');
  expect((await f.run('purge')).kind).toBe('done'); expect(f.removed).toEqual(['IngressRoute/original']);
  for (const replacement of [false, true]) {
    const changed = await clusterDeletionFixture(); await changed.put(deletionObject('Middleware', 'original')); await changed.plan(); await changed.run('seal');
    if (replacement) await changed.k8s.mergePatch(Resources.Middleware!, 'original', TARGET.namespace, { metadata: { uid: 'replacement' } });
    else await changed.k8s.create(deletionObject('Secret', 'unknown'));
    expect((await changed.run('purge')).kind).toBe('blocked'); expect(changed.removed).toEqual([]);
  }
  const revoked = await clusterDeletionFixture(); await revoked.put(deletionObject('Secret', 'original')); await revoked.plan(); await revoked.run('seal'); revoked.revoke();
  await expect(revoked.run('prove')).rejects.toThrow('失效'); expect(revoked.removed).toEqual([]);
});

test('清理前原 UID 或公开台账归属发生竞态时拒绝删除，且不移除原 finalizer', async () => {
  for (const replaceUid of [true, false]) {
    const f = await clusterDeletionFixture(); await f.put(deletionObject('IngressRoute', 'original')); await f.plan(); await f.run('seal');
    const get = f.k8s.get.bind(f.k8s); let reads = 0;
    f.k8s.get = async (...args) => {
      if (args[0].kind === 'IngressRoute' && ++reads === 1) {
        if (replaceUid) await f.k8s.mergePatch(Resources.IngressRoute!, 'original', TARGET.namespace, { metadata: { uid: 'replacement' } });
        else { const key = 'IngressRoute/' + TARGET.namespace + '/original'; f.claims.set(key, { ...f.claims.get(key)!, projectId: undefined }); }
      }
      return get(...args);
    };
    await expect(f.run('prove')).rejects.toThrow(); expect(f.removed).toEqual([]);
    expect(await get(Resources.IngressRoute!, 'original', TARGET.namespace)).toBeDefined();
  }
});
