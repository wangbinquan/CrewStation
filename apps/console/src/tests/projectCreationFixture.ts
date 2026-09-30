import { ProjectDtoSchema } from '@crewstation/contracts';
import type { ManifestKind, PlatformRole, ProjectDto } from '@crewstation/contracts';
import { summaryFixtureItem } from './projectSummaryFixture';

export const creationUserId = '01a0bf5d-8f4b-7f8b-8136-e631380738b0', creationProjectId = '01a0bf5d-8f4b-7aef-84b8-c458233bab22';
export const creationPlanId = '01a0bf5d-8f4b-7000-9e4b-b54e91ee9d10';
const templates = [
  { id: '01a0bf5d-8f4b-7002-9560-94caf593fb19', name: 'minimal-sample', kind: 'DigitalWorker', servicePlan: creationPlanId, requiredConfig: [] },
  { id: '01a0e222-de8b-7000-8cd8-207c8673b62e', name: 'business-execution-v3', kind: 'DigitalWorker', servicePlan: creationPlanId, requiredConfig: [] },
  { id: '01a0bf5d-8f4b-7003-9dbe-4adc78f388e9', name: 'reference-api-proxy', kind: 'APIProxy', servicePlan: creationPlanId, requiredConfig: [{ name: 'GITLAB_TOKEN', from: 'secret' }] },
  { id: '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbc', name: 'gitlab-event-producer', kind: 'EventProducer', servicePlan: creationPlanId, requiredConfig: [] },
  { id: '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbd', name: 'github-event-producer', kind: 'EventProducer', servicePlan: creationPlanId, requiredConfig: [] },
];

export function creationFixtureProject(index: number, kind: ManifestKind = 'DigitalWorker'): ProjectDto {
  return ProjectDtoSchema.parse({ id: `01a0bf5d-8f4b-7a01-8000-${index.toString(16).padStart(12, '0')}`, serviceId: `01a0bf5d-8f4b-7a02-8000-${index.toString(16).padStart(12, '0')}`,
    slug: `worker-${index}`, name: `数字助手 ${index}`, kind, namespace: `cs-worker-${index}`, ownerUserId: creationUserId, state: 'active', createdAt: '2026-09-30T00:00:00.000Z' });
}

export function projectCreationFixture(role: PlatformRole = 'admin') {
  const requests: Array<{ path: string; url: URL; method: string; body?: Record<string, unknown> }> = [];
  const state = { catalogFailure: false, settingsFailure: false, createFailure: false, projectFailure: false, retryFailure: false, noTemplates: false,
    status: 'provisioning', holdCreate: undefined as Promise<void> | undefined, resultOverride: undefined as Record<string, unknown> | undefined,
    domainFailure: false, domainMismatch: false, domainHolds: new Map<string, Promise<void>>(), project: undefined as ProjectDto | undefined,
    rows: [] as ProjectDto[], domain: 'installed.apps.test' };
  const me = { id: creationUserId, name: '管理者', email: 'admin@test.invalid', platformRole: role, isAdmin: role === 'admin', memberships: [] };
  globalThis.fetch = (async (raw, init) => {
    const url = new URL(String(raw), 'http://localhost'), path = url.pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ path, url, method, body });
    let result: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') result = me;
    else if (path === '/v1/users') result = { items: [me] };
    else if (path === '/v1/catalog/project-creation') {
      if (state.settingsFailure) { status = 503; result = { error: 'unavailable', message: '创建目录离线' }; }
      else result = { templates: state.noTemplates ? [] : templates.filter((item) => item.kind === 'DigitalWorker'), defaultServicePlan: creationPlanId, maxConcurrentTasks: 3 };
    } else if (path === '/v1/catalog/project-templates') {
      if (state.catalogFailure) { status = 503; result = { error: 'unavailable', message: '模板目录离线' }; }
      else result = { items: state.noTemplates ? [] : templates };
    } else if (path === '/v1/catalog/service-plans') result = { items: [{ id: creationPlanId, name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '小套餐' },
      { id: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4', name: 'standard-large', cpu: '2', memory: '4Gi', maxReplicas: 4, description: '大套餐' }] };
    else if (path === '/v1/catalog/project-domain-preview') {
      const slug = url.searchParams.get('slug') ?? ''; await state.domainHolds.get(slug);
      if (state.domainFailure) { status = 503; result = { error: 'unavailable', message: '域名规则离线' }; }
      else result = { slug: state.domainMismatch ? 'other-slug' : slug, prodHost: `${slug}.${state.domain}`, previewHost: `preview.${slug}.${state.domain}`, serviceHost: `${slug}.services.test` };
    } else if (path === '/v1/projects' && method === 'POST') {
      if (state.holdCreate) await state.holdCreate;
      if (state.createFailure) { status = 409; result = { error: 'conflict', message: '项目标识已占用', details: { field: 'slug' } }; }
      else { state.project = ProjectDtoSchema.parse({ ...body, ownerUserId: body!.ownerUserId ?? creationUserId, id: creationProjectId, serviceId: '01a0bf5d-8f4b-7aef-84b8-c458233bab23', namespace: `cs-${body!.slug}`, createdAt: '2026-09-30T00:00:00.000Z', state: state.status });
        result = { ...state.project, ...state.resultOverride }; }
    } else if (path === '/v1/projects/page' || path === '/v1/workbench/project-summaries') {
      let rows = [...state.rows, ...(state.project ? [state.project] : [])];
      const kinds = url.searchParams.get('kind')?.split(','); if (kinds) rows = rows.filter((item) => kinds.includes(item.kind));
      const q = url.searchParams.get('q'); if (q) rows = rows.filter((item) => `${item.name} ${item.slug}`.includes(q));
      const offset = url.searchParams.has('cursor') ? 20 : 0, limit = Number(url.searchParams.get('limit') ?? 20);
      const items = rows.slice(offset, offset + limit).map((project, index) => path.includes('summaries') ? { ...summaryFixtureItem(index + 1), project, role: role === 'admin' ? 'admin' : 'owner' } : { project, role: role === 'admin' ? 'admin' : 'owner', ownerName: me.name });
      result = { items, ...(rows.length > offset + limit ? { nextCursor: 'page-2' } : {}) };
    } else if (path === `/v1/projects/${creationProjectId}`) {
      if (state.projectFailure) { status = 503; result = { error: 'unavailable', message: '状态暂时无法读取' }; }
      else result = { ...(state.project ?? creationFixtureProject(99, 'APIProxy')), id: creationProjectId, state: state.status, message: state.status === 'failed' ? 'ensureFirstRelease 失败：缺少 GITLAB_TOKEN' : undefined };
    } else if (path.endsWith('/provision')) {
      if (state.retryFailure) { status = 503; result = { error: 'unavailable', message: '排队失败' }; }
      else { status = 202; result = { queued: true }; }
    } else if (path.endsWith('/dev-session')) { status = 404; result = { error: 'not_found', message: '没有会话' }; }
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, requests, writes: () => requests.filter((r) => r.method !== 'GET') };
}
