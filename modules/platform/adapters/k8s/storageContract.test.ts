import { expect, test } from 'bun:test';
import { createFakeK8sClient, type K8sClient } from '@crewstation/k8s';
import { assertStorageConsumers } from './storageContract';

const roles = ['cs-api', 'cs-auth', 'cs-controller', 'cs-session', 'cs-events', 'console'];
async function fixture() {
  const k8s = createFakeK8sClient(), addresses = new Map<string, string>();
  for (const [i, name] of roles.entries()) {
    const ip = `10.0.0.${i + 1}`; addresses.set(ip, name);
    await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name, uid: Bun.randomUUIDv7(), namespace: 'system', labels: { 'app.kubernetes.io/part-of': 'crewstation', 'app.kubernetes.io/name': name } },
      status: { podIP: ip, containerStatuses: [{ state: { running: {} } }] } });
  }
  const fetcher = (async (url: string | URL | Request) => Response.json({ name: addresses.get(new URL(String(url)).hostname), storageContractVersion: 1 })) as typeof fetch;
  return { k8s, fetcher };
}
test('each running Pod must advertise the actual storage contract; old ReplicaSets and unreachable instances block activation', async () => {
  const { k8s, fetcher } = await fixture();
  await expect(assertStorageConsumers(k8s, 'system', 1, fetcher)).resolves.toBeUndefined();
  await k8s.apply({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'old-controller', namespace: 'system', uid: Bun.randomUUIDv7(), labels: { 'app.kubernetes.io/part-of': 'crewstation', 'app.kubernetes.io/name': 'cs-controller' } }, status: { podIP: '10.0.0.99', containerStatuses: [{ state: { running: {} } }] } });
  await expect(assertStorageConsumers(k8s, 'system', 1, fetcher)).rejects.toMatchObject({ details: { code: 'storage_consumers_incompatible', component: 'cs-controller' } });
  await k8s.mergePatch({ apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true }, 'old-controller', 'system', { status: { phase: 'Running', containerStatuses: [{ state: { terminated: {} } }] } });
  await expect(assertStorageConsumers(k8s, 'system', 1, fetcher)).rejects.toMatchObject({ details: { code: 'storage_consumers_incompatible' } });
  await k8s.mergePatch({ apiVersion: 'v1', kind: 'Pod', plural: 'pods', namespaced: true }, 'old-controller', 'system', { status: { phase: 'Succeeded', containerStatuses: [{ state: { terminated: {} } }] } });
  await expect(assertStorageConsumers(k8s, 'system', 1, fetcher)).resolves.toBeUndefined();
  await expect(assertStorageConsumers(k8s, 'system', 1, (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch)).rejects.toMatchObject({ details: { code: 'storage_consumers_incompatible' } });
  await expect(assertStorageConsumers(k8s, 'system', 2, fetcher)).rejects.toMatchObject({ details: { code: 'storage_consumers_incompatible' } });
});
test('pagination is complete and missing console is not mistaken for readiness; no writes happen during probes', async () => {
  const { k8s, fetcher } = await fixture(); let pages = 0;
  const paged = { ...k8s, listPage: async (...args: Parameters<K8sClient['listPage']>) => {
    const all = await k8s.list(args[0], args[1], { labelSelector: args[2]?.labelSelector }); pages++;
    return { resourceVersion: '1', items: args[2]?.continue ? all.slice(3) : all.slice(0, 3), continue: args[2]?.continue ? '' : 'more' };
  } } as K8sClient;
  await assertStorageConsumers(paged, 'system', 1, fetcher); expect(pages).toBe(2);
  const missing = { ...k8s, listPage: async (...args: Parameters<K8sClient['listPage']>) => { const result = await k8s.listPage(...args); return { ...result, items: result.items.filter((p) => p.metadata.name !== 'console') }; } } as K8sClient;
  await expect(assertStorageConsumers(missing, 'system', 1, fetcher)).rejects.toMatchObject({ details: { code: 'storage_consumers_missing' } });
});
