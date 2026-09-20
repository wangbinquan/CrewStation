import { expect, test } from 'bun:test';
import { createFakeK8sClient, createK8sClient, Resources } from '@crewstation/k8s';
import { kubernetesClusterReader } from '../adapters/k8s/clusterReader';
import { projectResources } from '../domain/projection';
import { catalog, facts, object } from './inventoryFixture';
test('continue pages are complete, a 410 resets the whole batch, cancellation does not produce an empty success', async () => {
  const cursors: string[] = []; let expired = false;
  const client = createK8sClient({ server: 'https://k8s.invalid', defaultNamespace: 'cs-demo' }, (async (raw) => {
    const cursor = new URL(String(raw)).searchParams.get('continue') ?? ''; cursors.push(cursor);
    if (cursor === 'second' && !expired) { expired = true; return Response.json({ message: 'expired' }, { status: 410 }); }
    return Response.json({ metadata: { resourceVersion: expired ? 'fresh' : 'old', continue: cursor ? '' : 'second' }, items: [object('Pod', cursor ? 'two' : expired ? 'one-new' : 'one-old')] });
  }) as typeof fetch);
  const reader = kubernetesClusterReader(client), result = await reader.collect('Pod', 'cs-demo', undefined, new AbortController().signal);
  expect(cursors).toEqual(['', 'second', '', 'second']); expect(result.objects.map((o) => o.metadata.name)).toEqual(['one-new', 'two']); expect(result.resourceVersion).toBe('fresh');
  await expect(reader.collect('Pod', 'cs-demo', undefined, AbortSignal.abort())).rejects.toThrow();
});
test('events bind UID, init/previous logs are bounded and UID replacement during read is rejected', async () => {
  const k8s = createFakeK8sClient(); const pod = await k8s.create(object('Pod', 'task', 'cs-demo', { containers: [{ name: 'main' }], initContainers: [{ name: 'init' }] }));
  const row = projectResources([pod], facts, 'crewstation-system', catalog, new Date().toISOString())[0]!;
  await k8s.create({ ...object('Event', 'old'), involvedObject: { uid: 'old-pod' }, message: 'wrong event' }); await k8s.create({ ...object('Event', 'current'), involvedObject: { uid: pod.metadata.uid }, message: 'current event' });
  const reader = kubernetesClusterReader(k8s); expect((await reader.events(row)).items.map((i) => i.message)).toEqual(['current event']);
  let previous = false, cancelled = false;
  k8s.logs = async (_ns, _pod, options) => { previous = options?.previous ?? false; return new ReadableStream({ start(c) { c.enqueue(new Uint8Array(2_000_010).fill(65)); }, cancel() { cancelled = true; } }); };
  const logs = await reader.logs(row, { container: 'init', previous: 'true', tailLines: 100 }); expect(logs.truncated).toBe(true); expect(logs.text.length).toBe(2_000_000); expect(previous && cancelled).toBe(true);
  await expect(reader.logs(row, { container: 'missing', previous: 'false', tailLines: 10 })).rejects.toThrow('容器不存在');
  k8s.logs = async () => { await k8s.mergePatch(Resources.Pod!, 'task', 'cs-demo', { metadata: { uid: 'replaced' } }); return new ReadableStream({ start(c) { c.close(); } }); };
  await expect(reader.logs(row, { container: 'main', previous: 'false', tailLines: 10 })).rejects.toThrow('替换');
});
