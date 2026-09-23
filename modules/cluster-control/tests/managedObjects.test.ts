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
      PersistentVolumeClaim: [], Secret: [{ type: 'ADDED', object: { ...object('Secret', 's', '3'), data: { token: 'c2VjcmV0' } } }], Service: [], IngressRoute: [],
    };
    const lists: Record<string, K8sObject[]> = { Pod: [object('Pod', 'a', '1')], PersistentVolumeClaim: [object('PersistentVolumeClaim', 'w', '1')], Secret: [], Service: [object('Service', 'task-1', '1')], IngressRoute: [] };
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
    expect(selectors).toEqual(Array.from({ length: 5 }, () => 'app.kubernetes.io/managed-by=crewstation'));
    expect(seen.some((c) => c.kind === 'PersistentVolumeClaim' && c.object.metadata.name === 'w' && !c.gone)).toBe(true);
    expect(seen.some((c) => c.kind === 'Service' && c.object.metadata.name === 'task-1')).toBe(true);
    // Secret 的内容不进缓存，也不交给处理者。
    expect(seen.find((c) => c.kind === 'Secret')?.object.metadata.name).toBe('s'); expect(JSON.stringify(seen)).not.toContain('c2VjcmV0');
    expect(feed.cached('Secret', 'cs-demo', 's')).toBeDefined(); expect(JSON.stringify(feed.cached('Secret', 'cs-demo', 's'))).not.toContain('c2VjcmV0');
    expect(seen.filter((c) => c.kind === 'Pod').at(-1)).toMatchObject({ gone: true, object: { metadata: { name: 'a' } } });
  });
});
