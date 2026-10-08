import { expect, test } from 'bun:test';
import { createFilesystemMetricsHandler, NodeFileConsumerRequestSchema, nodeFileConsumerRequestDigest } from '@crewstation/filesystem-metrics';
import type { NodeFileConsumerRequest } from '@crewstation/filesystem-metrics';
import { nativeBuildKitProjectWork } from '../adapters/k8s/nativeProjectWork/buildKit';
import { nativePodWork } from '../adapters/k8s/nativeProjectWork/pods';
import { withNativeWork } from './nativeWorkFixture';

/** Original probe stays on its strict pair protocol. The controlled private
 * host uses actual file/thread metadata rather than a precomputed zero reply. */
function birthHost(f: Parameters<Parameters<typeof withNativeWork>[0]>[0]) {
  const token = 'native-work-birth-original-token-1234567890', requests: NodeFileConsumerRequest[] = [];
  const sdk = createFilesystemMetricsHandler({ token, roots: {}, procRoot: f.proc.root });
  const fetcher = (async (url, init) => {
    if (new URL(String(url)).pathname === '/native/registry/file-consumers') {
      const request = new Request(String(url), init); expect(request.headers.get('authorization')).toBe('Bearer ' + token);
      const body = NodeFileConsumerRequestSchema.parse(await request.json()); requests.push(body);
      const observed = await sdk(new Request('http://probe/consumers', { method: 'POST', headers: { authorization: 'Bearer ' + token },
        body: JSON.stringify({ mode: 'observe', source: { bootId: body.origin.bootId, namespace: body.origin.namespace }, identities: body.identities }) }));
      expect(observed.ok).toBe(true);
      return Response.json({ originIdentity: body.origin.identity, identitiesDigest: nodeFileConsumerRequestDigest(body.identities), observation: await observed.json() });
    }
    if (new URL(String(url)).pathname === '/consumers') {
      const body = JSON.parse(String(init?.body));
      expect(body.identities.every((row: Record<string, unknown>) => !('birthtimeNs' in row))).toBe(true);
    }
    return f.options.fetch!(url, init);
  }) as typeof fetch;
  return { requests, fetch: fetcher, consumerBirth: { baseUrl: 'http://native/', token } };
}
test('BuildKit original and current observations pass every retained physical file birth through the production source', async () => withNativeWork(async f => {
  const transport = birthHost(f), source = nativeBuildKitProjectWork({ ...f.buildOptions, ...transport });
  const original = await source.capture(f.target, { consumers: [], callbacks: [] });
  expect(original.originalFiles.length).toBeGreaterThan(0);
  await source.inspect(original);
  expect(transport.requests).toHaveLength(2);
  for (const request of transport.requests) {
    expect(request.origin).toEqual(original.consumers);
    expect(request.identities).toEqual(original.originalFiles.map(({ device, inode, birthtimeNs }) => ({ device, inode, birthtimeNs })));
    expect(request.identities.every(row => BigInt(row.birthtimeNs ?? '0') > 0n)).toBe(true);
  }
}));
test('Pod workspace capture and later original/current inventories retain file births without changing the probe origin', async () => withNativeWork(async f => {
  await f.installWork('runtime-environment'); const transport = birthHost(f), source = nativePodWork({ ...f.options, ...transport });
  const original = await source.capture({ mode: 'runtime-environment', target: f.target, consumerIds: [f.consumerId] }, []);
  await source.inspect(original);
  const workspace = original.workspaces[0]!, files = workspace.inventory.volumes.flatMap(row => row.files.map(({ device, inode, birthtimeNs }) => ({ device, inode, birthtimeNs })));
  expect(files.length).toBeGreaterThan(0); expect(transport.requests).toHaveLength(2);
  for (const request of transport.requests) { expect(request.origin).toEqual(workspace.consumers); expect(request.identities).toEqual(files); }
}));
