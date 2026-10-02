import { expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { EVENT_DELIVERY_FINALIZER, eventDeliveryOwners, projectCallbackOwners } from './eventDeliveryOwners';

async function fixture() {
  const k8s = createFakeK8sClient(),podUid = Bun.randomUUIDv7(),nodeUid = Bun.randomUUIDv7();
  await k8s.apply({ apiVersion: 'v1',kind: 'Node',metadata: { name: 'node',uid: nodeUid },status: { conditions: [{ type: 'Ready',status: 'True' }],nodeInfo: { kubeletVersion: 'v1.34.0' } } });
  await k8s.apply({ apiVersion: 'coordination.k8s.io/v1',kind: 'Lease',metadata: { name: 'node',namespace: 'kube-node-lease',ownerReferences: [{ apiVersion: 'v1',kind: 'Node',name: 'node',uid: nodeUid }] },spec: { holderIdentity: 'node',renewTime: new Date().toISOString() } });
  await k8s.apply({ apiVersion: 'v1',kind: 'Pod',metadata: { name: 'sender',namespace: 'system',uid: podUid,resourceVersion: '1',finalizers: ['another/guard'],labels: { 'app.kubernetes.io/name': 'cs-events','app.kubernetes.io/part-of': 'crewstation' } },
    spec: { nodeName: 'node',containers: [{ name: 'cs-events' }] },status: { phase: 'Running',containerStatuses: [{ name: 'cs-events',containerID: 'containerd://original',state: { running: {} } }] } });
  const owners = eventDeliveryOwners(k8s,'system',podUid);
  const terminal = { containerID: 'containerd://original',exitCode: 0,finishedAt: new Date().toISOString() };
  const stop = () => k8s.mergePatch(Resources.Pod!,'sender','system',{ metadata: { deletionTimestamp: new Date().toISOString() },status: { phase: 'Succeeded',containerStatuses: [{ name: 'cs-events',containerID: terminal.containerID,state: { terminated: terminal } }] } });
  return { k8s,owners,podUid,nodeUid,terminal,stop };
}
test('原进程准入固定 Pod／容器／节点，原 UID CAS 加保护，重复保护稳定且保留其他 finalizer',async () => {
  const f = await fixture();
  expect(await f.owners.protectCurrent()).toEqual({ podUid: f.podUid,containerId: 'containerd://original',nodeUid: f.nodeUid,nodeName: 'node' });
  expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toEqual(['another/guard',EVENT_DELIVERY_FINALIZER]);
  expect(await f.owners.protectCurrent()).toMatchObject({ containerId: 'containerd://original' });
  for (const uid of [undefined,Bun.randomUUIDv7()]) await expect(eventDeliveryOwners(f.k8s,'system',uid).protectCurrent()).rejects.toThrow();
  await f.stop(); await expect(f.owners.protectCurrent()).rejects.toThrow();
});
test('同 Pod 重启只证明原 containerID，运行中的新实例不被停止或解除保护',async () => {
  const f = await fixture(); await f.owners.protectCurrent(); const stopped: object[] = [];
  await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ status: { containerStatuses: [{ name: 'cs-events',containerID: 'containerd://replacement',restartCount: 1,state: { running: {} },lastState: { terminated: f.terminal } }] } });
  await f.owners.sweep({ stopped: async (process,digest) => { stopped.push(process); expect(digest).toMatch(/^[a-f0-9]{64}$/); },releasable: async () => true });
  expect(stopped).toEqual([{ podUid: f.podUid,containerId: 'containerd://original',nodeUid: f.nodeUid,nodeName: 'node' }]);
  expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toContain(EVENT_DELIVERY_FINALIZER);
  expect(await f.owners.protectCurrent()).toMatchObject({ containerId: 'containerd://replacement' });
});
test('实际终止证明先持久，再移除自身保护；PG 故障和仍有原在途事实都保留原 Pod',async () => {
  const f = await fixture(); await f.owners.protectCurrent(); await f.stop();
  await expect(f.owners.sweep({ stopped: async () => { throw new Error('database-unavailable'); },releasable: async () => true })).rejects.toThrow('database-unavailable');
  expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toContain(EVENT_DELIVERY_FINALIZER);
  let received = 0;
  const accept = { stopped: async (process: { podUid: string; containerId: string }) => { expect(process).toMatchObject({ podUid: f.podUid,containerId: f.terminal.containerID }); received += 1; },releasable: async () => false };
  await f.owners.sweep(accept); expect(received).toBe(1);
  expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toContain(EVENT_DELIVERY_FINALIZER);
  await f.owners.sweep({ ...accept,releasable: async () => true });
  expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toEqual(['another/guard']);
});
test('节点失联／旧租约／无实际终止身份／未知状态／原 Pod 缺失都不能恢复退出',async () => {
  for (const mode of ['node','lease','kubelet','node-lost','missing-id','unknown','absent']) {
    const f = await fixture(); await f.owners.protectCurrent(); await f.stop(); let stopped = false;
    if (mode === 'node') await f.k8s.delete(Resources.Node!,'node');
    if (mode === 'lease') await f.k8s.mergePatch(Resources.Lease!,'node','kube-node-lease',{ spec: { renewTime: '2000-01-01T00:00:00Z' } });
    if (mode === 'kubelet') await f.k8s.mergePatch(Resources.Node!,'node',undefined,{ status: { nodeInfo: { kubeletVersion: 'v1.26.0' } } });
    if (mode === 'node-lost') await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ status: { reason: 'NodeLost' } });
    if (mode === 'missing-id' || mode === 'unknown') await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ status: { containerStatuses: [{ name: 'cs-events',state: { terminated: { ...f.terminal,...(mode === 'missing-id' ? { containerID: undefined } : { reason: 'ContainerStatusUnknown' }) } } }] } });
    if (mode === 'absent') await f.k8s.delete(Resources.Pod!,'sender','system');
    await f.owners.sweep({ stopped: async () => { stopped = true; },releasable: async () => false }); expect(stopped).toBe(false);
  }
});
test('运行 sidecar／临时容器、替换节点或在确认期间替换 Pod 都不能解除原保护',async () => {
  for (const mode of ['sidecar','ephemeral','node-replaced','pod-replaced']) {
    const f = await fixture(); await f.owners.protectCurrent(); await f.stop();
    if (mode === 'sidecar') await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ spec: { containers: [{ name: 'cs-events' },{ name: 'sidecar' }] },status: { containerStatuses: [{ name: 'cs-events',state: { terminated: f.terminal } },{ name: 'sidecar',state: { running: {} } }] } });
    if (mode === 'ephemeral') await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ spec: { ephemeralContainers: [{ name: 'debug' }] },status: { ephemeralContainerStatuses: [{ name: 'debug',state: { running: {} } }] } });
    if (mode === 'node-replaced') {
      const uid = Bun.randomUUIDv7(); await f.k8s.mergePatch(Resources.Node!,'node',undefined,{ metadata: { uid } });
      await f.k8s.mergePatch(Resources.Lease!,'node','kube-node-lease',{ metadata: { ownerReferences: [{ apiVersion: 'v1',kind: 'Node',name: 'node',uid }] } });
    }
    const accept = { stopped: async (process: { nodeUid: string }) => {
      if (mode === 'node-replaced') expect(process.nodeUid).not.toBe(f.nodeUid);
      if (mode === 'pod-replaced') await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ metadata: { uid: Bun.randomUUIDv7() } });
    },releasable: async () => mode !== 'node-replaced' };
    if (mode === 'pod-replaced') await expect(f.owners.sweep(accept)).rejects.toThrow(); else await f.owners.sweep(accept);
    expect((await f.k8s.get(Resources.Pod!,'sender','system'))?.metadata.finalizers).toContain(EVENT_DELIVERY_FINALIZER);
  }
});
test('全量分页之后才保护当前实例，重复游标／读取失败和错误承载容器拒绝准入',async () => {
  const f = await fixture(),original = f.k8s.listPage.bind(f.k8s); let pages = 0;
  const paged = { ...f.k8s,listPage: (async (...args: Parameters<typeof f.k8s.listPage>) => {
    pages += 1; const page = await original(args[0],args[1],{ ...args[2],continue: undefined }); return { ...page,items: pages === 1 ? [] : page.items,continue: pages === 1 ? 'second' : '' };
  }) as typeof f.k8s.listPage };
  await eventDeliveryOwners(paged,'system',f.podUid).protectCurrent(); expect(pages).toBe(2);
  const repeated = { ...f.k8s,listPage: (async (...args: Parameters<typeof f.k8s.listPage>) => ({ ...await original(...args),continue: 'repeated' })) as typeof f.k8s.listPage };
  await expect(eventDeliveryOwners(repeated,'system',f.podUid).protectCurrent()).rejects.toThrow('分页游标重复');
  await expect(eventDeliveryOwners({ ...f.k8s,listPage: async () => { throw new Error('source-unavailable'); } },'system',f.podUid).protectCurrent()).rejects.toThrow('source-unavailable');
  await f.k8s.mergePatch(Resources.Pod!,'sender','system',{ spec: { containers: [{ name: 'other' }] } });
  await expect(f.owners.protectCurrent()).rejects.toThrow();
});
test('API 承载的网关、数据库、SCM 与事件回调使用独立保护；排空一个 owner 不解除另一个及外部 finalizer', async () => {
  const f = await fixture(), gatewayFinalizer = 'crewstation.io/gateway-project-stop' as const;
  await f.k8s.mergePatch(Resources.Pod!, 'sender', 'system', { metadata: { labels: { 'app.kubernetes.io/name': 'cs-api' } },
    spec: { containers: [{ name: 'cs-api' }] }, status: { containerStatuses: [{ name: 'cs-api', containerID: 'containerd://original', state: { running: {} } }] } });
  const gateway = projectCallbackOwners(f.k8s, 'system', f.podUid, gatewayFinalizer);
  const nativeFinalizer = 'crewstation.io/data-control-native-stop' as const, native = projectCallbackOwners(f.k8s, 'system', f.podUid, nativeFinalizer);
  const scmFinalizer = 'crewstation.io/scm-project-stop' as const, scm = projectCallbackOwners(f.k8s, 'system', f.podUid, scmFinalizer);
  expect(await gateway.protectCurrent()).toEqual({ podUid: f.podUid, containerId: 'containerd://original', nodeUid: f.nodeUid, nodeName: 'node' });
  expect(await native.protectCurrent()).toEqual({ podUid: f.podUid, containerId: 'containerd://original', nodeUid: f.nodeUid, nodeName: 'node' });
  expect(await scm.protectCurrent()).toEqual({ podUid: f.podUid, containerId: 'containerd://original', nodeUid: f.nodeUid, nodeName: 'node' });
  await f.owners.protectCurrent();
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toEqual(['another/guard', gatewayFinalizer, nativeFinalizer, scmFinalizer, EVENT_DELIVERY_FINALIZER]);
  await f.k8s.mergePatch(Resources.Pod!, 'sender', 'system', { metadata: { deletionTimestamp: new Date().toISOString() }, status: { phase: 'Succeeded',
    containerStatuses: [{ name: 'cs-api', containerID: f.terminal.containerID, state: { terminated: f.terminal } }] } });
  const seen: object[] = [];
  await gateway.sweep({ stopped: async (process) => { seen.push(process); }, releasable: async () => true });
  expect(seen).toEqual([{ podUid: f.podUid, containerId: 'containerd://original', nodeUid: f.nodeUid, nodeName: 'node' }]);
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toEqual(['another/guard', nativeFinalizer, scmFinalizer, EVENT_DELIVERY_FINALIZER]);
  await native.sweep({ stopped: async () => {}, releasable: async () => true });
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toEqual(['another/guard', scmFinalizer, EVENT_DELIVERY_FINALIZER]);
  await scm.sweep({ stopped: async () => {}, releasable: async () => true });
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toEqual(['another/guard', EVENT_DELIVERY_FINALIZER]);
  await f.owners.sweep({ stopped: async () => {}, releasable: async () => true });
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toEqual(['another/guard']);
});

for (const finalizer of ['crewstation.io/gateway-project-stop', 'crewstation.io/data-control-native-stop', 'crewstation.io/scm-project-stop', 'crewstation.io/cluster-project-stop'] as const) test(`${finalizer} 拒绝缺失 UID、读取故障和未实际退出，不从 Pod 消失补造停止回执`, async () => {
  const f = await fixture();
  await expect(projectCallbackOwners(f.k8s, 'system', undefined, finalizer).protectCurrent()).rejects.toThrow();
  const gateway = projectCallbackOwners(f.k8s, 'system', f.podUid, finalizer); await gateway.protectCurrent();
  let stopped = 0; const accept = { stopped: async () => { stopped += 1; }, releasable: async () => true };
  await gateway.sweep(accept); expect(stopped).toBe(0);
  expect((await f.k8s.get(Resources.Pod!, 'sender', 'system'))?.metadata.finalizers).toContain(finalizer);
  await expect(projectCallbackOwners({ ...f.k8s, listPage: async () => { throw new Error('source-unavailable'); } }, 'system', f.podUid, finalizer).sweep(accept)).rejects.toThrow('source-unavailable');
  await f.k8s.delete(Resources.Pod!, 'sender', 'system'); await gateway.sweep(accept); expect(stopped).toBe(0);
});
