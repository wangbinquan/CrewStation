import { describe, expect, test } from 'bun:test';
import type { K8sClient, K8sObject, WatchEventType } from '@crewstation/k8s';
import { createFakeK8sClient } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { managedObjectFeed, managedObjectReader } from '../adapters/k8s/managedObjects';
import type { ObjectChange } from '../ports/cluster';

const managed = { 'app.kubernetes.io/managed-by': 'crewstation' };
const object = (kind: string, name: string, rv: string, labels: Record<string, string> = managed): K8sObject => ({ apiVersion: 'v1', kind, metadata: { name, namespace: 'cs-demo', uid: `uid-${name}`, resourceVersion: rv, labels } });

describe('受管对象的列表与变化流（设计 §6.1）', () => {
  test('一次性列表只要带受管标签的 Pod 与 PVC', async () => {
    const k8s = createFakeK8sClient();
    await k8s.apply(object('Pod', 'mine', '1'));
    await k8s.apply(object('Pod', 'not-mine', '1', {}));
    await k8s.apply(object('PersistentVolumeClaim', 'work', '1'));
    const reader = managedObjectReader(k8s);
    expect((await reader.list('Pod')).map((o) => o.metadata.name)).toEqual(['mine']);
    expect((await reader.list('PersistentVolumeClaim')).map((o) => o.metadata.name)).toEqual(['work']);
  });

  test('全量与 watch 的变化按对象去重后逐个交给处理者，删除带 gone', async () => {
    const selectors: string[] = [];
    const scripts: Record<string, { type: WatchEventType; object: K8sObject }[]> = {
      Pod: [{ type: 'MODIFIED', object: object('Pod', 'a', '5') }, { type: 'DELETED', object: object('Pod', 'a', '6') }],
      PersistentVolumeClaim: [],
    };
    const k8s = {
      listPage: async (ref: { kind: string }, _ns: unknown, options: { labelSelector?: string }) => {
        selectors.push(options.labelSelector ?? '');
        return { items: ref.kind === 'Pod' ? [object('Pod', 'a', '1')] : [object('PersistentVolumeClaim', 'w', '1')], resourceVersion: '2', continue: '' };
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
    expect(selectors).toEqual(['app.kubernetes.io/managed-by=crewstation', 'app.kubernetes.io/managed-by=crewstation']);
    expect(seen.some((c) => c.kind === 'PersistentVolumeClaim' && c.object.metadata.name === 'w' && !c.gone)).toBe(true);
    expect(seen.filter((c) => c.kind === 'Pod').at(-1)).toMatchObject({ gone: true, object: { metadata: { name: 'a' } } });
  });
});
