import { newResourceId, noopLogger } from '@crewstation/kernel';
import { runtimeImageUseCases } from '../application/runtimeImages';
import { registryForwardAuthRoutes } from '../http/adminRoutes';

/** Local disposable registry only. The caller removes its container/storage after acceptance. */
export async function liveRegistryMountFixture(origin: string) {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/' || endpoint.username || endpoint.password) throw new Error('Mount acceptance requires a disposable loopback registry origin');
  let now = new Date();
  const layout = { pullBase: endpoint.host, pushHost: endpoint.host, baseRepository: 'crewstation/task-runtime', runtimePrefix: 'runtime/' };
  const api = runtimeImageUseCases({ registry: { layout, resolveDigest: async () => { throw new Error('unused'); } }, clock: { now: () => now }, logger: noopLogger }, { signingKey: new TextEncoder().encode('acceptance-only-signing-key'), baseTag: 'dev', ttlSeconds: 600 });
  const projectId = newResourceId(), buildId = newResourceId();
  const credential = await api.issueBuildPushCredential({ projectId, buildId, expiresAt: new Date(now.getTime() + 600000).toISOString(), pullRepositories: [layout.baseRepository] });
  const authorization = `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString('base64')}`;
  const auth = registryForwardAuthRoutes(api);
  let forwarded = 0;
  const gateway = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const url = new URL(request.url);
    const response = await auth.request('/forward-auth/registry', { headers: { 'x-forwarded-method': request.method, 'x-forwarded-uri': url.pathname + url.search, authorization: request.headers.get('authorization') ?? '' } });
    if (response.status !== 200) return response;
    forwarded++;
    return fetch(new URL(url.pathname + url.search, endpoint), { method: request.method, headers: request.headers, redirect: 'manual', ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }) });
  } });
  return {
    endpoint, base: layout.baseRepository, target: `runtime/projects/${projectId}/${buildId}/image`, foreign: `runtime/projects/${newResourceId()}/${buildId}/image`,
    forwarded: () => forwarded, expire: () => { now = new Date(now.getTime() + 600001); }, close: () => gateway.stop(true),
    request: (path: string, method = 'POST') => fetch(new URL(path, gateway.url), { method, headers: { authorization }, redirect: 'manual' }),
  };
}

export async function uploadBlob(origin: URL, repository: string, value: string) {
  const digest = `sha256:${new Bun.CryptoHasher('sha256').update(value).digest('hex')}`;
  const start = await fetch(new URL(`/v2/${repository}/blobs/uploads/`, origin), { method: 'POST' });
  if (start.status !== 202) throw new Error(`Fixture blob upload failed: ${start.status}`);
  const url = new URL(start.headers.get('location')!, origin); url.searchParams.set('digest', digest);
  const uploaded = await fetch(url, { method: 'PUT', body: value, headers: { 'content-type': 'application/octet-stream' } });
  if (uploaded.status !== 201) throw new Error(`Fixture blob commit failed: ${uploaded.status}`);
  return digest;
}
