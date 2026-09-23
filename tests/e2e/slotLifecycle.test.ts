import { afterAll, describe, expect, test } from 'bun:test';
import { apiGet, e2eAvailable, open } from './consoleSession';
import { openAdminSession } from './session';

/**
 * RFC-021 待验证版本下线与正式版本维护的实机验收。
 *
 * 这里只发只读请求和必然被拒的写请求：本机集群是共享的，进入维护、下线、重新部署会影响别人的项目，
 * 改平台设置会改所有项目的到期时间。会改状态的流程在专门的验收项目上按 acceptance.md 实机核对。
 */
const available = await e2eAvailable();
const session = available ? await openAdminSession() : undefined;
const project = session?.project;

interface Reply { readonly status: number; readonly body: { readonly error?: string } | null }
/** 带状态码的写请求；工作台的写请求同样只靠会话 Cookie。 */
function send(method: string, path: string, body: unknown): Promise<Reply> {
  return session!.admin.eval<Reply>(`fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { accept: 'application/json', 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
}

interface Policy { readonly rollbackRetentionHours: number; readonly idleOfflineDays: number; readonly reminderLeadHours: number; readonly revision: number }

afterAll(async () => {
  await session?.close();
}, 30_000);

describe.skipIf(!session)('RFC-021 平台设置（不改动设置）', () => {
  test('管理员读到三个时长与版本号；版本号过期 409、提醒不短于保留期 400，设置都不变', async () => {
    const policy = await apiGet<Policy>(session!.admin, '/v1/admin/settings/auto-offline');
    expect(policy.rollbackRetentionHours).toBeGreaterThan(policy.reminderLeadHours);
    expect(policy.idleOfflineDays * 24).toBeGreaterThan(policy.reminderLeadHours);
    const values = { rollbackRetentionHours: policy.rollbackRetentionHours, idleOfflineDays: policy.idleOfflineDays, reminderLeadHours: policy.reminderLeadHours };
    expect((await send('PUT', '/v1/admin/settings/auto-offline', { ...values, expectedRevision: policy.revision + 1000 })).status).toBe(409);
    expect((await send('PUT', '/v1/admin/settings/auto-offline', { ...values, reminderLeadHours: policy.rollbackRetentionHours, expectedRevision: policy.revision })).status).toBe(400);
    expect((await apiGet<Policy>(session!.admin, '/v1/admin/settings/auto-offline')).revision).toBe(policy.revision);
  }, 45_000);

  test('平台设置页在管理左栏末尾的「平台」组里，渲染三个时长', async () => {
    await open(session!.admin, '/admin/settings');
    const text = await session!.admin.text();
    for (const marker of ['待验证版本自动下线', '回退目标保留', '待验证版本无人访问', '提前提醒']) expect(text).toContain(marker);
    expect(await session!.admin.eval<string | null>(`document.querySelector('nav a[href="/admin/settings"]')?.textContent ?? null`)).toBe('平台设置');
    expect(session!.admin.takeErrors()).toEqual([]);
  }, 45_000);
});

interface Slot { readonly name: 'prod' | 'preview'; readonly releaseId?: string; readonly host: string; readonly retention?: { readonly kind: string; readonly deadline: string; readonly periodHours: number }; readonly offline?: { readonly reason: string } }

// 全新集群（CI）里没有已开通的数字人项目，整组显式跳过，见 tests/e2e/README.md。
describe.skipIf(!project)('RFC-021 数字人项目的维护与待命槽（只读）', () => {
  test('维护状态、待命槽记录与槽上的计时／下线形状都来自真实接口', async () => {
    const serviceId = (await apiGet<{ serviceId: string }>(session!.admin, `/v1/projects/${project!.id}`)).serviceId;
    const maintenance = await apiGet<{ current: unknown; history: unknown[] }>(session!.admin, `/v1/services/${serviceId}/maintenance`);
    expect('current' in maintenance).toBe(true); expect(Array.isArray(maintenance.history)).toBe(true);
    expect(Array.isArray((await apiGet<{ items: unknown[] }>(session!.admin, `/v1/services/${serviceId}/slot-events`)).items)).toBe(true);
    const preview = (await apiGet<{ items: Slot[] }>(session!.admin, `/v1/services/${serviceId}/slots`)).items.find((slot) => slot.name === 'preview')!;
    if (preview.retention) { expect(['rollback-target', 'pending']).toContain(preview.retention.kind); expect(preview.retention.periodHours).toBeGreaterThan(0); expect(Number.isNaN(Date.parse(preview.retention.deadline))).toBe(false); }
    if (preview.offline) expect(['manual', 'rollback-expired', 'idle', 'cluster']).toContain(preview.offline.reason);
    // 缺字段的写请求在任何状态下都被拒，不会改动项目。
    expect((await send('POST', `/v1/services/${serviceId}/slots/preview/offline`, {})).status).toBe(400);
    expect((await send('PUT', `/v1/services/${serviceId}/maintenance`, { switches: { users: true, services: true, events: true }, allowUserIds: [], reason: '', expectedRevision: 0 })).status).toBe(400);
  }, 45_000);

  test('待命槽上没有版本时，试用地址给出未部署说明页而不是网关错误', async () => {
    const serviceId = (await apiGet<{ serviceId: string }>(session!.admin, `/v1/projects/${project!.id}`)).serviceId;
    const preview = (await apiGet<{ items: Slot[] }>(session!.admin, `/v1/services/${serviceId}/slots`)).items.find((slot) => slot.name === 'preview')!;
    if (preview.releaseId || !preview.host) return; // 待命槽上有版本：这条只在它为空时有意义。
    await session!.admin.goto(`http://${preview.host}/`);
    expect(await session!.admin.bodyText()).toContain('当前没有待验证版本');
  }, 45_000);
});
