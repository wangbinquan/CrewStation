import { describe, expect, test } from 'bun:test';
import type { Actor, HealthDto, ProjectId, ProjectPageEntry, ReleaseDto, ServiceId, SlotDto, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, ProjectPageQuerySchema, ProjectSummaryDetailSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { fixedClock, notFound } from '@crewstation/kernel';
import { projectSummaryUseCases } from '../application/projectSummaries';
import type { ProjectSummarySources } from '../ports/projectSummaries';
import { projectSummaryRoutes } from '../http/projectSummaryRoutes';

const clock = fixedClock('2026-09-13T00:00:00Z'), time = clock.now().toISOString();
const actor: Actor = { userId: `usr_${'a'.repeat(32)}` as UserId, isAdmin: false };
const entry = (n = 1): ProjectPageEntry => ({ project: { id: `prj_${n.toString(16).padStart(32, '0')}` as ProjectId,
  serviceId: `svc_${n.toString(16).padStart(32, '0')}` as ServiceId, slug: `app-${n}`, name: `App ${n}`, kind: 'DigitalWorker',
  namespace: `cs-app-${n}`, ownerUserId: actor.userId, state: 'active', createdAt: time }, role: 'owner', ownerName: 'Owner' });
const first = entry();
const slots: SlotDto[] = [{ name: 'prod', active: true, state: 'empty', host: 'app.test', replicas: 0, readyReplicas: 0 },
  { name: 'preview', active: false, state: 'ready', host: 'preview.app.test', replicas: 1, readyReplicas: 1,
    releaseId: `rel_${'b'.repeat(32)}`, tag: 'v1.0.0', commitSha: 'b'.repeat(40) } as SlotDto];
const health: HealthDto[] = [{ slot: 'prod', state: 'unknown', readyReplicas: 0, replicas: 0, restarts: 0, lastTransitionAt: time },
  { slot: 'preview', state: 'healthy', readyReplicas: 1, replicas: 1, restarts: 0, lastTransitionAt: time }];
const session = { id: `tsk_${'c'.repeat(32)}`, projectId: first.project.id, serviceId: first.project.serviceId!, kind: 'dev-session' as const,
  state: 'running' as const, connected: false, branch: 'main', createdBy: actor.userId, createdAt: time, lastActivityAt: time };
function setup(override: Partial<ProjectSummarySources> = {}, budgetMs = 2500) {
  const sources: ProjectSummarySources = { list: async () => ({ items: [first] }), read: async () => [first], get: async () => first,
    session: async () => session, slots: async () => slots, health: async () => health, releases: async () => [], switches: async () => [], ...override };
  return projectSummaryUseCases(sources, clock, budgetMs);
}
const query = (value: Record<string, unknown> = {}) => ProjectPageQuerySchema.parse(value);

describe('当前页项目摘要聚合', () => {
  test('会话记录与连接分开、实际两槽与健康分开；列表不读取发布历史', async () => {
    let histories = 0;
    const api = setup({ releases: async () => { histories++; return []; }, switches: async () => { histories++; return []; } });
    const item = (await api.listProjectSummaries(actor, query())).items[0]!;
    expect(item.development).toMatchObject({ status: 'ready', value: { taskId: session.id, state: 'running', connected: false } });
    expect(item.slots).toMatchObject({ status: 'ready', value: slots }); expect(item.health).toMatchObject({ status: 'ready', value: health });
    expect(item.checkedAt).toBe(time); expect(histories).toBe(0); expect(item).not.toHaveProperty('releases');
    expect(JSON.stringify(item)).not.toContain('previewStatus'); expect(item.development).not.toHaveProperty('value.preview');
  });
  test('独立失败不抹掉其他事实；空健康不是正常，服务缺失不是已发布', async () => {
    const item = await setup({ session: async () => { throw new Error('runtime offline'); }, health: async () => [] }).getProjectSummary(actor, first.project.id);
    expect(item.development.status).toBe('unknown'); expect(item.health.status).toBe('unknown'); expect(item.slots.status).toBe('ready');
    const missing = { ...first, project: { ...first.project, serviceId: undefined, state: 'provisioning' as const } };
    let calls = 0;
    const absent = await setup({ get: async () => missing, read: async () => [missing], session: async () => undefined,
      slots: async () => { calls++; return slots; }, health: async () => { calls++; return health; } }).getProjectSummary(actor, first.project.id);
    expect(absent.development).toMatchObject({ status: 'ready', value: null }); expect(absent.slots.status).toBe('unknown'); expect(calls).toBe(0);
  });
  test('实际来源回执的会话／服务不匹配、重复槽、缺 SHA 和重复健康均保持未知', async () => {
    for (const bad of [{ ...session, projectId: entry(2).project.id }, { ...session, serviceId: entry(2).project.serviceId! }, { ...session, kind: 'business' as const }]) {
      expect((await setup({ session: async () => bad }).getProjectSummary(actor, first.project.id)).development).toMatchObject({ status: 'unknown', reason: 'invalid' });
    }
    for (const bad of [[slots[0]!], [slots[0]!, slots[0]!], [slots[0]!, { ...slots[1]!, commitSha: undefined }]]) {
      expect((await setup({ slots: async () => bad }).getProjectSummary(actor, first.project.id)).slots.status).toBe('unknown');
    }
    expect((await setup({ health: async () => [health[0]!, health[0]!] }).getProjectSummary(actor, first.project.id)).health.status).toBe('unknown');
  });
  test('分页只聚合当前页，最多四个在途读取，完整保留 nextCursor', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => entry(i + 1)); let active = 0, maximum = 0;
    const seen: string[] = [], called: string[] = [];
    const load = async <T,>(id: string, value: T) => { seen.push(id); maximum = Math.max(maximum, ++active); await Bun.sleep(1); active--; return value; };
    const api = setup({ list: async (_a, q) => { called.push(q.cursor!); return { items: entries, nextCursor: 'next' }; }, read: async (_a, ids) => { expect(ids).toHaveLength(20); return entries; },
      session: async (id) => load(id, undefined), slots: async (_a, id) => load(id, []), health: async (_a, id) => load(id, health) });
    const page = await api.listProjectSummaries(actor, query({ cursor: 'current' }));
    expect(page.items).toHaveLength(20); expect(page.nextCursor).toBe('next'); expect(maximum).toBe(4); expect(seen).toHaveLength(60); expect(called).toEqual(['current']);
    expect(seen.every((id) => entries.some((e) => e.project.id === id || e.project.serviceId === id))).toBe(true);
  });
  test('截止后停止后续读取，迟到结果不改已返回响应；健康慢不阻止本页开发与版本摘要', async () => {
    const entries = Array.from({ length: 8 }, (_, i) => entry(i + 1)); const finish: Array<() => void> = []; let healthCalls = 0;
    const api = setup({ list: async () => ({ items: entries }), read: async () => entries, session: async () => undefined, slots: async () => [],
      health: async () => { healthCalls++; await new Promise<void>((resolve) => { finish.push(resolve); }); return health; } }, 30);
    const page = await api.listProjectSummaries(actor, query());
    expect(healthCalls).toBe(4); expect(page.items.every((i) => i.development.status === 'ready' && i.slots.status === 'ready')).toBe(true);
    expect(page.items.every((i) => i.health.status === 'unknown')).toBe(true);
    finish.forEach((resolve) => resolve()); await Bun.sleep(1);
    expect(healthCalls).toBe(4); expect(page.items.every((i) => i.health.status === 'unknown')).toBe(true);
  });
  test('初始测试者不读取内部状态；返回前撤销、降级与服务替换不交付旧事实', async () => {
    let calls = 0;
    const restricted = { ...first, role: 'tester' as const };
    const dto = await setup({ get: async () => restricted, read: async () => [restricted], session: async () => { calls++; return session; }, slots: async () => { calls++; return slots; } }).getProjectSummary(actor, first.project.id);
    expect(calls).toBe(0); expect(dto.development.status).toBe('restricted'); expect(dto.releases.status).toBe('restricted');
    const changed = await setup({ read: async () => [restricted] }).getProjectSummary(actor, first.project.id);
    expect(changed.role).toBe('tester'); expect(changed.slots.status).toBe('restricted');
    const replaced = await setup({ read: async () => [{ ...first, project: { ...first.project, serviceId: entry(2).project.serviceId } }] }).getProjectSummary(actor, first.project.id);
    expect(replaced.development.status).toBe('unknown');
    expect((await setup({ read: async () => [] }).listProjectSummaries(actor, query())).items).toEqual([]);
    await expect(setup({ read: async () => [] }).getProjectSummary(actor, first.project.id)).rejects.toMatchObject({ kind: 'not_found' });
    await expect(setup({ read: async () => { throw new Error('scope offline'); } }).listProjectSummaries(actor, query())).rejects.toThrow('scope offline');
  });
  test('详情活动只保留该服务最近五笔真实发布，坏回执不借用其他服务的记录', async () => {
    const releases: ReleaseDto[] = Array.from({ length: 7 }, (_, i) => ({ id: `rel_${i.toString(16).padStart(32, '0')}` as ReleaseDto['id'], serviceId: first.project.serviceId!,
      tag: `v1.0.${i}`, commitSha: 'b'.repeat(40), branch: 'main', status: 'failed', createdBy: actor.userId, createdAt: `2026-09-13T00:00:0${i}.000Z`, updatedAt: time }));
    const item = await setup({ releases: async () => releases }).getProjectSummary(actor, first.project.id);
    expect(ProjectSummaryDetailSchema.safeParse(item).success).toBe(true);
    expect(item.releases.status === 'ready' && item.releases.value.map((r) => r.tag)).toEqual(['v1.0.6', 'v1.0.5', 'v1.0.4', 'v1.0.3', 'v1.0.2']);
    expect((await setup({ releases: async () => [{ ...releases[0]!, serviceId: entry(2).project.serviceId! }] }).getProjectSummary(actor, first.project.id)).releases.status).toBe('unknown');
  });
  test('HTTP 两入口认证、校验、禁止缓存；真实查询失败不冒充无项目', async () => {
    const app = createApp({ name: 'summary-test' }); app.route('/', projectSummaryRoutes(setup(), async () => false));
    const headers = { [IDENTITY_HEADERS.userId]: actor.userId };
    expect((await app.request('/v1/workbench/project-summaries')).status).toBe(401);
    for (const search of ['limit=51', 'limit=0', 'kind=anything', 'state=healthy', 'ownerUserId=bad']) expect((await app.request(`/v1/workbench/project-summaries?${search}`, { headers })).status).toBe(400);
    for (const path of ['', `/${first.project.id}`]) {
      const response = await app.request(`/v1/workbench/project-summaries${path}`, { headers });
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    }
    await expect(setup({ list: async () => { throw notFound('scope', 'x'); } }).listProjectSummaries(actor, query())).rejects.toMatchObject({ kind: 'not_found' });
  });
});
