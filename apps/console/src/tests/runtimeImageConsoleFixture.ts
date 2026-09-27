import { RuntimeImageBuildDtoSchema, RuntimeImageDtoSchema, RuntimeImageRevisionDtoSchema, RuntimeImageVersionDtoSchema } from '@crewstation/contracts';

export const riId = (n: number) => `01a0bf5d-8f4b-7111-8111-${String(n).padStart(12, '0')}`;
export const riProject = riId(10), riImage = riId(11), riVersion = riId(12), riProfile = riId(13);
const at = '2026-09-27T00:00:00.000Z', digest = `sha256:${'a'.repeat(64)}`;
export function runtimeImageConsoleFixture(admin = false, role = 'owner') {
  const original = globalThis.fetch, writes: Array<{ url: string; body: Record<string, unknown> }> = [], reads: string[] = [];
  const image = RuntimeImageDtoSchema.parse({ id: riImage, projectId: riProject, name: 'Python tools', description: '', scope: 'project', enabled: true, revision: 1, createdBy: riId(1), createdAt: at, updatedAt: at });
  const revision = RuntimeImageRevisionDtoSchema.parse({ id: riId(14), imageId: riImage, revision: 1, source: { kind: 'existing', reference: `registry.test/tools@${digest}`, architecture: 'linux/amd64', usage: 'task' }, recipeDigest: digest, initializer: { steps: [], env: {}, secrets: [] }, tools: [], createdBy: riId(1), createdAt: at });
  const revisions = [revision];
  const build = RuntimeImageBuildDtoSchema.parse({ id: riId(15), imageId: riImage, projectId: riProject, revisionId: revision.id, state: 'building', stage: 'build', createdBy: riId(1), createdAt: at, updatedAt: at, deadline: at, attempt: 1 });
  const version = RuntimeImageVersionDtoSchema.parse({ id: riVersion, imageId: riImage, projectId: riProject, revisionId: revision.id, buildId: build.id, repository: 'registry.test/tools', digest, architecture: 'linux/amd64', state: 'available', createdAt: at, initializerDigest: digest, toolsDigest: digest });
  const policy = { projectId: riProject, revision: 7, developmentTask: { runtimeImageVersionId: riVersion }, developmentAgents: [{ profileId: riProfile, selection: { allowedRuntimeImageVersionIds: [riId(16)] } }] };
  const state = { conflict: false, references: 0, buildFailure: false, setupFailure: false };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://test'), path = url.pathname, method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = init?.body ? JSON.parse(String(init.body)) : {}; writes.push({ url: path, body });
      if (path.endsWith('/setup') && state.setupFailure) return Response.json({ error: 'unavailable', message: 'response lost' }, { status: 503 });
      if (path.endsWith('/setup')) return Response.json({ image, revision: { ...revision, ...body.recipe as object } }, { status: 201 });
      if (path.endsWith('/builds')) return state.buildFailure ? Response.json({ error: 'unavailable', message: 'builder unavailable' }, { status: 503 }) : Response.json(build, { status: 202 });
      if (path.endsWith(`/${riImage}`) && method === 'PATCH') {
        if (body.expectedRevision !== image.revision) return Response.json({ error: 'conflict', message: '镜像已修改' }, { status: 409 });
        Object.assign(image, body, { revision: image.revision + 1 }); return Response.json(image);
      }
      if (path.endsWith('/cancel')) return Response.json({ ...build, state: 'cancelling' });
      if (path.endsWith('/revisions')) return Response.json({ ...revision, ...body, id: riId(17), revision: 2 }, { status: 201 });
      if (path.endsWith('/validations')) return Response.json({ id: riId(18), versionId: riVersion, projectId: riProject, target: body.target, state: 'queued', checks: [], contractDigest: digest, createdBy: riId(1), createdAt: at, updatedAt: at }, { status: 202 });
      if (path.endsWith('/development-runtime-images')) return state.conflict ? Response.json({ error: 'conflict', message: '配置已修改', details: {} }, { status: 409 }) : Response.json({ ...policy, ...body, revision: policy.revision + 1 });
      if (path.endsWith('/disable')) { version.state = 'disabled'; return Response.json(version); }
      if (method === 'DELETE') { version.state = 'retired'; return Response.json({ version, physicalDeletion: 'pending-maintenance' }); }
      if (path.endsWith('/runtime-images') && method === 'POST') return Response.json(image, { status: 201 });
      return Response.json({ error: 'not_found', message: `未配置测试写入：${method} ${path}`, details: {} }, { status: 404 });
    }
    reads.push(String(url));
    if (path === '/v1/projects') return Response.json({ items: [{ id: riProject, name: 'Tools project', state: 'active' }] });
    if (path.endsWith('/me')) return Response.json({ id: riId(1), isAdmin: admin, platformRole: admin ? 'admin' : 'developer', memberships: [{ projectId: riProject, role }] });
    if (path.endsWith(`/v1/projects/${riProject}`)) return Response.json({ id: riProject, name: 'Tools project', serviceId: riId(22) });
    if (path.endsWith('/history')) return Response.json({ items: [{ id: riId(24), versionId: riVersion, projectId: riProject, serviceId: riId(22), kind: 'task', state: 'released', createdAt: at, updatedAt: at, traceId: 'a'.repeat(32) }, { id: riId(23), versionId: riVersion, projectId: riProject, serviceId: riId(22), kind: 'service', state: 'offline', name: 'v1.2.0', createdAt: at, updatedAt: at }] });
    if (path.includes('/runtime-image-versions/')) return Response.json({ ...version, id: path.split('/').at(-1), name: image.name });
    if (path.endsWith('/references')) return Response.json({ items: [], total: state.references });
    if (path.endsWith('/grants')) return Response.json({ defaultVisible: false, retainedProjectIds: [riProject], overrides: [] });
    if (path.endsWith('/development-runtime-images')) return Response.json(policy);
    if (path.endsWith('/compute-profiles')) return Response.json({ items: [{ id: riProfile, name: 'Agent A', revision: 3, description: '', isDefault: true, available: true, availability: { available: true }, terminalOnly: false }] });
    if (path.endsWith('/runtime-images') || path.endsWith('/runtime-image-catalog')) return Response.json({ items: [image] });
    if (path.endsWith('/revisions')) { const start = url.searchParams.has('before') ? revisions.findIndex((item) => item.id === url.searchParams.get('before')) + 1 : 0; return Response.json({ items: revisions.slice(start, start + Number(url.searchParams.get('limit') ?? 20)) }); }
    if (path.endsWith('/builds')) return Response.json({ items: [build] });
    if (path.endsWith('/versions')) return Response.json({ items: [version] });
    if (path.endsWith('/validations')) return Response.json({ items: [{ id: riId(18), versionId: riVersion, projectId: riProject, target: { usage: 'service', command: ['start'], port: 3000, healthPath: '/health' }, state: 'passed', verification: 'service-contract', checks: [], contractDigest: digest, createdBy: riId(1), createdAt: at, updatedAt: at }] });
    if (path.endsWith('/logs')) return Response.json({ expired: false, items: url.searchParams.get('after') === '0' ? [{ sequence: 1, stage: 'build', text: 'install complete', createdAt: at }] : [], next: 1, truncated: false, expiresAt: '2026-10-01T00:00:00.000Z' });
    if (path.endsWith(`/${riImage}`)) return Response.json(image);
    if (path.endsWith(`/versions/${riVersion}`)) return Response.json(version);
    return Response.json({ error: 'not_found', message: `未配置测试读取：${path}`, details: {} }, { status: 404 });
  }) as typeof fetch;
  return { writes, reads, revision, revisions, policy, state, restore: () => { globalThis.fetch = original; } };
}
