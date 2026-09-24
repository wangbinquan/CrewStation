import { describe, expect, test } from 'bun:test';
import type { K8sClient, K8sObject, WatchEventType } from '@crewstation/k8s';
import { createFakeK8sClient, Resources } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { kubernetesClusterWriter, managedObjectFeed, managedObjectReader } from '../adapters/k8s/managedObjects';
import type { ObjectChange } from '../ports/cluster';

const managed = { 'app.kubernetes.io/managed-by': 'crewstation' };
const object = (kind: string, name: string, rv: string, labels: Record<string, string> = managed): K8sObject => ({ apiVersion: 'v1', kind, metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, resourceVersion: rv, labels } });

describe('受管对象的列表与变化流（设计 §6.1）', () => {
  test('一次性列表只要带受管标签的对象；Secret 的内容不带出来', async () => {
    const k8s = createFakeK8sClient();
    await k8s.apply(object('Pod', 'mine', '1'));
    await k8s.apply(object('Pod', 'not-mine', '1', {}));
    await k8s.apply(object('PersistentVolumeClaim', 'work', '1'));
    await k8s.apply({ ...object('Secret', 'task-1-runner', '1'), data: { CS_RUNNER_TOKEN: 'c2VjcmV0' } });
    const reader = managedObjectReader(k8s);
    expect((await reader.list('Pod')).map((o) => o.metadata.name)).toEqual(['mine']);
    expect((await reader.list('PersistentVolumeClaim')).map((o) => o.metadata.name)).toEqual(['work']);
    const secrets = await reader.list('Secret');
    expect(secrets.map((o) => o.metadata.name)).toEqual(['task-1-runner']); expect(JSON.stringify(secrets)).not.toContain('c2VjcmV0');
  });

  test('调和器的删除带 UID 前置条件：对象没了与换了实例都算完成，别的错误照抛', async () => {
    const k8s = createFakeK8sClient();
    await k8s.apply(object('Pod', 'task-1', '1'));
    const writer = kubernetesClusterWriter(k8s);
    await writer.remove({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', uid: 'uid-other' });
    expect(await k8s.get(Resources.Pod!, 'task-1', 'cs-demo')).toBeDefined();
    await writer.remove({ kind: 'Pod', namespace: 'cs-demo', name: 'task-1', uid: 'uid-task-1' });
    expect(await k8s.get(Resources.Pod!, 'task-1', 'cs-demo')).toBeUndefined();
    await writer.remove({ kind: 'Secret', namespace: 'cs-demo', name: 'gone', uid: 'uid-gone' });
    const failing = kubernetesClusterWriter({ ...k8s, delete: async () => { throw new Error('API Server 不可用'); } });
    await expect(failing.remove({ kind: 'Service', namespace: 'cs-demo', name: 'x', uid: 'u' })).rejects.toThrow('API Server 不可用');
  });

  test('全量与 watch 的变化按对象去重后逐个交给处理者，删除带 gone', async () => {
    const selectors: string[] = [];
    const scripts: Record<string, { type: WatchEventType; object: K8sObject }[]> = {
      Pod: [{ type: 'MODIFIED', object: object('Pod', 'a', '5') }, { type: 'DELETED', object: object('Pod', 'a', '6') }],
      PersistentVolumeClaim: [], Secret: [{ type: 'ADDED', object: { ...object('Secret', 's', '3'), data: { token: 'c2VjcmV0' } } }], Service: [], IngressRoute: [], Deployment: [], Job: [], Middleware: [],
      Namespace: [], ResourceQuota: [{ type: 'MODIFIED', object: object('ResourceQuota', 'crewstation-project', '4') }], NetworkPolicy: [],
    };
    // 命名空间是集群级对象：不带命名空间，按名字进缓存。
    const namespace: K8sObject = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'cs-demo', uid: 'uid-ns', resourceVersion: '1', labels: managed } };
    const lists: Record<string, K8sObject[]> = {
      Pod: [object('Pod', 'a', '1')], PersistentVolumeClaim: [object('PersistentVolumeClaim', 'w', '1')], Secret: [], Service: [object('Service', 'task-1', '1')], IngressRoute: [], Deployment: [object('Deployment', 'demo-green', '1')],
      Job: [object('Job', 'build-1', '1')], Middleware: [object('Middleware', 'rate-limit-user', '1')], Namespace: [namespace], ResourceQuota: [object('ResourceQuota', 'crewstation-project', '1')], NetworkPolicy: [object('NetworkPolicy', 'crewstation-default', '1')],
    };
    const k8s = {
      listPage: async (ref: { kind: string }, _ns: unknown, options: { labelSelector?: string }) => {
        selectors.push(options.labelSelector ?? '');
        return { items: lists[ref.kind]!, resourceVersion: '2', continue: '' };
      },
      watch: async (ref: { kind: string }, _ns: unknown, options: { signal?: AbortSignal }, onEvent: (type: WatchEventType, obj: K8sObject) => void) => {
        for (const event of scripts[ref.kind]!.splice(0)) onEvent(event.type, event.object);
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }));
      },
    } as unknown as K8sClient;
    const seen: ObjectChange[] = [];
    const feed = managedObjectFeed(k8s, { logger: noopLogger });
    feed.start(async (change) => { seen.push(change); });
    await feed.synced();
    const deadline = Date.now() + 2_000;
    while (!seen.some((c) => c.gone) && Date.now() < deadline) await Bun.sleep(5);
    await feed.stop();
    expect(selectors).toEqual(Array.from({ length: 11 }, () => 'app.kubernetes.io/managed-by=crewstation'));
    expect(seen.some((c) => c.kind === 'Middleware' && c.object.metadata.name === 'rate-limit-user')).toBe(true);
    // 第四期：命名空间（集群级）、额度与网络策略也观测；额度的状态变化（已用数）照样报来，由调和器决定改不改。
    expect(seen.some((c) => c.kind === 'Namespace' && c.object.metadata.name === 'cs-demo')).toBe(true);
    expect(feed.cached('Namespace', undefined, 'cs-demo')?.metadata.uid).toBe('uid-ns');
    expect(seen.filter((c) => c.kind === 'ResourceQuota').at(-1)?.object.metadata).toMatchObject({ name: 'crewstation-project', resourceVersion: '4' });
    expect(seen.some((c) => c.kind === 'NetworkPolicy' && c.object.metadata.name === 'crewstation-default')).toBe(true);
    expect(seen.some((c) => c.kind === 'Deployment' && c.object.metadata.name === 'demo-green')).toBe(true);
    expect(seen.some((c) => c.kind === 'Job' && c.object.metadata.name === 'build-1')).toBe(true);
    expect(seen.some((c) => c.kind === 'PersistentVolumeClaim' && c.object.metadata.name === 'w' && !c.gone)).toBe(true);
    expect(seen.some((c) => c.kind === 'Service' && c.object.metadata.name === 'task-1')).toBe(true);
    // Secret 的内容不进缓存，也不交给处理者。
    expect(seen.find((c) => c.kind === 'Secret')?.object.metadata.name).toBe('s'); expect(JSON.stringify(seen)).not.toContain('c2VjcmV0');
    expect(feed.cached('Secret', 'cs-demo', 's')).toBeDefined(); expect(JSON.stringify(feed.cached('Secret', 'cs-demo', 's'))).not.toContain('c2VjcmV0');
    expect(seen.filter((c) => c.kind === 'Pod').at(-1)).toMatchObject({ gone: true, object: { metadata: { name: 'a' } } });
  });
});

// RFC-025 I25：工作区容器按名字建，已在就不动；Runner Secret 只在不在时才向所属模块要内容；建时撞上同名的（回执丢了）按已在处理。
describe('工作区容器的建出', () => {
  const pod = { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', image: 'task:1', workerUid: 10001, resources: { cpu: '1', memory: '2Gi', storage: '10Gi' }, workload: 'dev-session', project: 'demo', service: 'demo', pvc: 'task-1-work', secret: 'task-1-runner-1' };

  test('不在才建（内容这时才要），已在返回原实例；预览缺了或不一致才 apply', async () => {
    const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
    let asked = 0;
    const values = async () => { asked += 1; return { CS_RUNNER_TOKEN: 't' }; };
    expect(await writer.ensureRunnerSecret(pod, values)).toEqual({ uid: 'uid-task-1-runner-1', created: true });
    expect(await writer.ensureRunnerSecret(pod, values)).toEqual({ uid: 'uid-task-1-runner-1', created: false });
    expect(asked).toBe(1);
    expect((await writer.ensurePod(pod)).created).toBe(true);
    expect((await writer.ensurePod(pod)).created).toBe(false);
    expect((await writer.ensureVolume({ name: 'task-1-work', namespace: 'cs-demo', size: '10Gi', labels: {} })).created).toBe(true);
    const preview = { name: 'task-1', namespace: 'cs-demo', taskId: 'rec-1', kind: 'dev-session', targetPort: 3000, route: { host: 'dev.demo.cs.localhost', middlewares: [] } };
    expect(await writer.applyPreview(preview, {})).toBe('applied');
    const service = await k8s.get(Resources.Service!, 'task-1', 'cs-demo'), route = await k8s.get(Resources.IngressRoute!, 'task-1', 'cs-demo');
    expect(await writer.applyPreview(preview, { service: service!, route: route! })).toBe('unchanged');
  });

  test('建时撞上同名的：按已在处理，返回那个实例；其余错误照抛', async () => {
    const k8s = createFakeK8sClient(), writer = kubernetesClusterWriter(k8s);
    const create = k8s.create;
    k8s.create = async (obj) => { await create(obj); return create(obj); };
    expect(await writer.ensurePod(pod)).toEqual({ uid: 'uid-task-1', created: false });
    k8s.create = async () => { throw new Error('API Server 不可用'); };
    await expect(writer.ensureVolume({ name: 'task-2-work', namespace: 'cs-demo', size: '10Gi', labels: {} })).rejects.toThrow('API Server 不可用');
  });
});
