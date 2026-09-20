import { expect, test } from 'bun:test';
import { createK8sClient } from './client';
import { Resources } from './resources';

test('paginated Kubernetes wire contract preserves continue and resourceVersion, signals and native kind', async () => {
  const calls: { url: URL; init: RequestInit }[] = [], signal = new AbortController().signal;
  const client = createK8sClient({ server: 'https://k8s.invalid', defaultNamespace: 'cs-demo' }, (async (raw, init) => { calls.push({ url: new URL(String(raw)), init: init! }); return Response.json({ metadata: { resourceVersion: 'rv', continue: 'next' }, items: [{ metadata: { name: 'work', uid: 'uid' } }] }); }) as typeof fetch);
  expect(await client.listPage(Resources.DaemonSet!, 'cs-system', { limit: 500, continue: 'start', signal, fieldSelector: 'status.phase=Running' })).toMatchObject({ resourceVersion: 'rv', continue: 'next', items: [{ apiVersion: 'apps/v1', kind: 'DaemonSet' }] });
  expect(calls[0]!.url.searchParams.get('continue')).toBe('start'); expect(calls[0]!.url.searchParams.get('limit')).toBe('500'); expect(calls[0]!.init.signal).toBe(signal);
  expect(calls[0]!.url.pathname).toBe('/apis/apps/v1/namespaces/cs-system/daemonsets');
});
test('JSON Patch preserves UID/RV tests and logs encode previous container/tail', async () => {
  const calls: { url: URL; init: RequestInit }[] = [];
  const client = createK8sClient({ server: 'https://k8s.invalid', defaultNamespace: 'cs-demo' }, (async (raw, init) => { calls.push({ url: new URL(String(raw)), init: init! }); return Response.json({ metadata: { name: 'work' } }); }) as typeof fetch);
  const patch = [{ op: 'test' as const, path: '/metadata/uid', value: 'uid' }, { op: 'add' as const, path: '/spec/replicas', value: 2 }];
  await client.jsonPatch(Resources.Deployment!, 'work', 'cs-demo', patch);
  expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json-patch+json' }); expect(JSON.parse(String(calls[0]!.init.body))).toEqual(patch);
  await client.logs('cs-demo', 'work', { container: 'init', previous: true, tailLines: 100, timestamps: true });
  expect(calls[1]!.url.searchParams.get('previous')).toBe('true'); expect(calls[1]!.url.searchParams.get('container')).toBe('init');
});
