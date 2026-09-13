import { describe, expect, test } from 'bun:test';
import type { Actor, ProjectId, ServiceId, SlotDto, UserId } from '@crewstation/contracts';
import { IDENTITY_HEADERS, MarketAppDtoSchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { fixedClock, notFound } from '@crewstation/kernel';
import { marketAppUseCases } from '../application/marketApps';
import type { MarketListingSource } from '../ports/market';
import { marketRoutes } from '../http/marketRoutes';

const actor: Actor = { userId: `usr_${'a'.repeat(32)}` as UserId, isAdmin: false };
const projectId = `prj_${'b'.repeat(32)}` as ProjectId;
const listing: MarketListingSource = { projectId, name: '市场应用', description: '整理知识', icon: 'book', owner: { userId: actor.userId, name: '负责人' }, projectState: 'active', canDevelop: false, canConfigure: false, visibilityRevision: 1, checkedAt: '2026-09-13T00:00:00.000Z', serviceId: `svc_${'c'.repeat(32)}` as ServiceId };
const clock = fixedClock('2026-09-13T00:00:00Z');
const slot = (overrides: Partial<SlotDto> = {}): SlotDto => ({ name: 'prod', active: true, replicas: 1, readyReplicas: 1, state: 'empty', host: 'app.example.test', ...overrides });
const setup = (slots: () => Promise<SlotDto[]>, get = async () => listing) => marketAppUseCases({ slots, get, list: async () => ({ items: [listing] }) }, clock);

describe('市场仅聚合正式部署且保留未知', () => {
  test('未上线不用 preview 冒充；失败或缺失发布元数据不算已上线', async () => {
    for (const slots of [[], [slot()], [slot({ name: 'preview', active: false, state: 'ready', tag: 'v9.0.0' }), slot()]]) {
      expect((await setup(async () => slots).getMarketApp(actor, projectId)).production.status).toBe('not-deployed');
    }
    expect((await setup(async () => { throw new Error('database offline'); }).getMarketApp(actor, projectId)).production).toMatchObject({ status: 'unknown', freshness: 'unknown' });
    expect((await setup(async () => [slot({ state: 'ready' })]).getMarketApp(actor, projectId)).production.status).toBe('unknown');
  });
  test('正式 tag／SHA／主机来自同一个 prod 记录，输出不含内部定位与项目数据', async () => {
    const dto = await setup(async () => [slot({ state: 'ready', tag: 'v1.2.3', commitSha: 'abc', releaseId: `rel_${'d'.repeat(32)}` as SlotDto['releaseId'] })]).getMarketApp(actor, projectId);
    expect(dto.production).toMatchObject({ status: 'deployed', tag: 'v1.2.3', commitSha: 'abc', host: 'app.example.test' });
    expect(dto).not.toHaveProperty('serviceId'); expect(dto).not.toHaveProperty('namespace'); expect(dto).not.toHaveProperty('userIds');
    expect(MarketAppDtoSchema.safeParse(dto).success).toBe(true);
  });
  test('聚合期间撤销范围时不返回旧元数据；真正查询失败不会伪装无应用', async () => {
    let reads = 0;
    const api = setup(async () => [], async () => { if (++reads > 1) throw notFound('应用', projectId); return listing; });
    await expect(api.getMarketApp(actor, projectId)).rejects.toMatchObject({ kind: 'not_found' });
    reads = 0; expect((await api.listMarketApps(actor, { q: '', limit: 20 })).items).toEqual([]);
    await expect(setup(async () => [], async () => { throw new Error('query failed'); }).listMarketApps(actor, { q: '', limit: 20 })).rejects.toThrow('query failed');
  });
  test('HTTP 市场接口要求登录，分页有界且响应不缓存', async () => {
    const http = createApp({ name: 'market-http' });
    http.route('/', marketRoutes({ name: 'capabilities', ...setup(async () => []), describe: async () => { throw new Error('unused'); } }, async () => false));
    const headers = { [IDENTITY_HEADERS.userId]: actor.userId };
    expect((await http.request('/v1/market/apps')).status).toBe(401);
    expect((await http.request('/v1/market/apps?limit=51', { headers })).status).toBe(400);
    const result = await http.request(`/v1/market/apps/${projectId}`, { headers });
    expect(result.status).toBe(200); expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await result.json()).toMatchObject({ projectId, canDevelop: false, production: { status: 'not-deployed' } });
  });
});
