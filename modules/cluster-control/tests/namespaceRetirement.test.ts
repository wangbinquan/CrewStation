import { describe, expect, test } from 'bun:test';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import type { K8sClient, K8sObject, ResourceRef } from '@crewstation/k8s';
import { inspectNamespaceRetirement, removeRetiredNamespace } from '../adapters/k8s/namespaceRetirement';

const namespace = 'cs-retired', intent = { uid: 'namespace-uid', children: [{ kind: 'Service', name: 'idle', namespace, uid: 'service-uid' }] };
const obj = (kind: string, name: string, extra: Partial<K8sObject> = {}): K8sObject => ({ apiVersion: Resources[kind]?.apiVersion ?? 'custom.test/v1', kind, metadata: { name, namespace }, ...extra });
async function fixture() {
  const k8s: K8sClient = createFakeK8sClient();
  const refs: ResourceRef[] = Object.values(Resources).filter((ref) => ref.namespaced);
  k8s.namespacedResources = async () => refs;
  await k8s.create(obj('Namespace', namespace, { metadata: { name: namespace, uid: intent.uid } }));
  await k8s.create(obj('Service', 'idle', { metadata: { name: 'idle', namespace, uid: 'service-uid' } }));
  return { k8s, refs, inspect: () => inspectNamespaceRetirement(k8s, namespace, intent, 'crewstation-system') };
}

describe('归档命名空间的完整集群盘点', () => {
  test('只允许确认过的空脚手架；删除带命名空间 UID 和资源版本，可重复执行', async () => {
    const { k8s, refs, inspect } = await fixture();
    refs.push({ apiVersion: 'v1', kind: 'Endpoints', plural: 'endpoints', namespaced: true }, { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', plural: 'endpointslices', namespaced: true });
    await k8s.create(obj('ServiceAccount', 'default'));
    await k8s.create(obj('ConfigMap', 'kube-root-ca.crt', { data: { 'ca.crt': 'certificate' } }));
    await k8s.create(obj('Event', 'event'));
    await k8s.create(obj('Endpoints', 'idle', { apiVersion: 'v1', metadata: { name: 'idle', namespace, labels: { 'endpoints.kubernetes.io/managed-by': 'endpoint-controller' } } }));
    const slice = obj('EndpointSlice', 'idle-slice', { apiVersion: 'discovery.k8s.io/v1', endpoints: [], metadata: { name: 'idle-slice', namespace, ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: 'idle', uid: 'service-uid', controller: true }] } });
    await k8s.create(slice);
    expect((await inspect())?.metadata.uid).toBe(intent.uid);
    await k8s.mergePatch(refs.at(-1)!, 'idle-slice', namespace, { endpoints: [{ addresses: ['10.0.0.1'] }] });
    await expect(inspect()).rejects.toThrow('EndpointSlice/idle-slice');
    await k8s.mergePatch(refs.at(-1)!, 'idle-slice', namespace, { endpoints: [] });
    const remove = k8s.delete.bind(k8s); let options: unknown;
    k8s.delete = async (ref, name, ns, given) => { options = given; return remove(ref, name, ns, given); };
    const version = (await inspect())!.metadata.resourceVersion;
    await removeRetiredNamespace(k8s, namespace, intent, 'crewstation-system');
    expect(options).toEqual({ preconditions: { uid: intent.uid, resourceVersion: version } });
    await removeRetiredNamespace(k8s, namespace, intent, 'crewstation-system');
  });
  test('无标签 PVC、未知 CRD、被替换的 Service 和附加系统配置均阻断', async () => {
    const { k8s, refs, inspect } = await fixture();
    const mouse = { apiVersion: 'custom.test/v1', kind: 'Mouse', plural: 'mice', namespaced: true };
    refs.push(mouse);
    // listPage 也可能来自聚合 API；按发现到的真实复数读取，不依赖标签。
    const list = k8s.listPage.bind(k8s);
    k8s.listPage = async (ref, ns, options) => ref.kind === 'Mouse' ? { items: [obj('Mouse', 'unmanaged')] as never, resourceVersion: '1', continue: '' } : list(ref, ns, options);
    await expect(inspect()).rejects.toThrow('Mouse/unmanaged');
    k8s.listPage = list;
    for (const blocked of [obj('PersistentVolumeClaim', 'retained'), obj('Secret', 'custom'), obj('ServiceAccount', 'default', { secrets: [{ name: 'kept' }] }), obj('ConfigMap', 'kube-root-ca.crt', { binaryData: { extra: 'data' } })]) {
      await k8s.create(blocked); await expect(inspect()).rejects.toThrow(blocked.kind + '/' + blocked.metadata.name);
      await k8s.delete(Resources[blocked.kind]!, blocked.metadata.name, namespace);
    }
    await k8s.mergePatch(Resources.Service!, 'idle', namespace, { metadata: { uid: 'replacement' } });
    await expect(inspect()).rejects.toThrow('Service/idle');
  });
  test('所有分页都要读；发现失败、读取失败、分页未推进及超限不能当空', async () => {
    const { k8s, inspect } = await fixture();
    k8s.namespacedResources = async () => [Resources.Pod!];
    k8s.listPage = async (_ref, _ns, options) => ({ items: options?.continue ? [obj('Pod', 'last-page')] as never : [], resourceVersion: '1', continue: options?.continue ? '' : 'second' });
    await expect(inspect()).rejects.toThrow('Pod/last-page');
    k8s.listPage = async () => ({ items: [], resourceVersion: '1', continue: 'stuck' });
    await expect(inspect()).rejects.toThrow('分页未推进');
    k8s.listPage = async () => ({ items: Array.from({ length: 10001 }, () => obj('Pod', 'many')) as never, resourceVersion: '1', continue: '' });
    await expect(inspect()).rejects.toThrow('超过上限');
    k8s.listPage = async () => { throw new Error('forbidden'); };
    await expect(inspect()).rejects.toThrow('forbidden');
    k8s.namespacedResources = async () => { throw new Error('discovery offline'); };
    await expect(inspect()).rejects.toThrow('discovery offline');
    delete k8s.namespacedResources;
    await expect(inspect()).rejects.toThrow('不支持完整资源发现');
  });
  test('系统命名空间、替换 UID、取消的租约均不删除；已删除中的不重复提交', async () => {
    const { k8s } = await fixture();
    for (const name of ['crewstation-system', 'default', 'kube-system']) await expect(removeRetiredNamespace(k8s, name, intent, 'crewstation-system')).rejects.toThrow('系统命名空间');
    await expect(removeRetiredNamespace(k8s, namespace, { ...intent, uid: 'old' }, 'crewstation-system')).rejects.toThrow('新实例');
    const abort = new AbortController(); abort.abort();
    await expect(removeRetiredNamespace(k8s, namespace, intent, 'crewstation-system', abort.signal)).rejects.toThrow();
    await k8s.mergePatch(Resources.Namespace!, namespace, undefined, { metadata: { deletionTimestamp: new Date().toISOString() } });
    await removeRetiredNamespace(k8s, namespace, intent, 'crewstation-system');
    expect(await k8s.get(Resources.Namespace!, namespace)).toBeDefined();
  });
});
