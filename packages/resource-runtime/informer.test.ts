import { describe, expect, test } from 'bun:test';
import type { K8sClient, K8sObject, WatchEventType } from '@crewstation/k8s';
import { Resources } from '@crewstation/k8s';
import { noopLogger } from '@crewstation/kernel';
import { createInformer } from './informer';

const pod = (name: string, rv: string, phase = 'Running'): K8sObject => ({ apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: 'cs-demo', resourceVersion: rv, uid: `uid-${name}` }, status: { phase } });

type WatchStep = { type: WatchEventType; object: K8sObject } | { gate: Promise<void> } | 'end' | 'error';

/** 脚本化的 API Server：list 依次返回给定的快照，watch 依次按脚本发事件。 */
function scriptedClient(lists: (K8sObject[] | Error)[], watches: WatchStep[][]) {
  const calls = { list: 0, watch: [] as (string | undefined)[] };
  const client = {
    listPage: async () => {
      const next = lists[Math.min(calls.list, lists.length - 1)]!;
      calls.list += 1;
      if (next instanceof Error) throw next;
      return { items: next, resourceVersion: `list-${calls.list}`, continue: '' };
    },
    watch: async (_ref: unknown, _ns: unknown, options: { resourceVersion?: string; signal?: AbortSignal }, onEvent: (type: WatchEventType, obj: K8sObject) => void) => {
      calls.watch.push(options.resourceVersion);
      const script = watches.shift();
      if (!script) {
        await new Promise<void>((resolve) => options.signal?.addEventListener('abort', () => resolve(), { once: true }));
        return;
      }
      for (const step of script) {
        if (options.signal?.aborted) return;
        if (step === 'end') return;
        if (step === 'error') throw new Error('连接被重置');
        if ('gate' in step) { await step.gate; continue; }
        onEvent(step.type, step.object);
      }
    },
  } as unknown as K8sClient;
  return { client, calls };
}

async function until(predicate: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待超时');
    await Bun.sleep(5);
  }
}

describe('观测缓存（RFC-025 设计 §6.1）', () => {
  test('全量后从 list 的版本续 watch；书签推进版本；增删改都进缓存并回调', async () => {
    const { client, calls } = scriptedClient([[pod('a', '1')]], [[
      { type: 'ADDED', object: pod('b', '2') },
      { type: 'MODIFIED', object: pod('a', '3', 'Failed') },
      { type: 'BOOKMARK', object: { apiVersion: 'v1', kind: 'Pod', metadata: { name: '', resourceVersion: '9' } } },
      { type: 'DELETED', object: pod('b', '10') },
      'end',
    ]]);
    const events: string[] = [];
    const informer = createInformer(client, Resources.Pod!, { upsert: (o) => events.push(`+${o.metadata.name}@${o.metadata.resourceVersion}`), remove: (o) => events.push(`-${o.metadata.name}`) }, { logger: noopLogger });
    informer.start();
    await informer.synced();
    await until(() => calls.watch.length >= 2);
    await informer.stop();
    expect(events).toEqual(['+a@1', '+b@2', '+a@3', '-b']);
    expect(calls.watch).toEqual(['list-1', '10']);
    expect(informer.list().map((o) => o.metadata.name)).toEqual(['a']);
    expect(informer.get('cs-demo', 'a')?.status).toEqual({ phase: 'Failed' });
    expect(informer.lastContact()).toBeGreaterThan(0);
  });

  test('版本过期（ERROR 事件）重新全量：没变的不再回调，列表里没了的报消失', async () => {
    const { client, calls } = scriptedClient([[pod('a', '1'), pod('b', '1')], [pod('a', '1'), pod('c', '5')]], [[{ type: 'ERROR', object: { apiVersion: 'v1', kind: 'Status', metadata: { name: '' }, code: 410 } }]]);
    const events: string[] = [];
    const informer = createInformer(client, Resources.Pod!, { upsert: (o) => events.push(`+${o.metadata.name}`), remove: (o) => events.push(`-${o.metadata.name}`) }, { logger: noopLogger });
    informer.start();
    await until(() => calls.list >= 2 && calls.watch.length >= 2);
    await informer.stop();
    expect(events).toEqual(['+a', '+b', '+c', '-b']);
  });

  test('出错按退避重连；全量核对周期到了也重新 list', async () => {
    let clock = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { client, calls } = scriptedClient([new Error('API Server 不可达'), [pod('a', '1')]], [[{ gate }, 'end']]);
    const informer = createInformer(client, Resources.Pod!, { upsert: () => undefined, remove: () => undefined }, { logger: noopLogger, backoff: { initialMs: 5, maxMs: 10 }, relistMs: 100, now: () => clock });
    informer.start();
    await informer.synced();
    expect(calls.list).toBe(2);
    await until(() => calls.watch.length >= 1);
    clock = 1_000;
    release();
    await until(() => calls.list >= 3);
    await informer.stop();
  });
});
