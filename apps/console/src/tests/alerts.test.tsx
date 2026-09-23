import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { alertId, alertsFixture, memberId, ownerId, projectId } from './alertsFixture';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch, route = `/projects/${projectId}/operations?tab=alerts`;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }
async function input(name: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!; expect(field).toBeDefined(); const select = field.tagName === 'SELECT';
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true })); if (!select) field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('真实告警状态、最近记录筛选和指定详情；槽由结构化字段定位，未知记录不回退到最新', async () => {
  alertsFixture(); page = await renderApp(`${route}&alertId=${alertId}`); expect(page.text()).toContain('只显示最近 100 条'); expect(page.text()).toContain('触发中');
  await click('查看当前待验证版本日志'); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'preview' });
  await page.navigate(`${route}&alertId=old-alert&alertState=resolved`); expect(page.text()).toContain('恢复时间'); expect(page.text()).toContain('没有提供可定位的关联对象'); expect(button('查看当前正式版本日志')).toBeUndefined();
  await page.navigate(`${route}&alertId=missing`); expect(page.text()).toContain('最近 100 条中未找到此告警'); expect(button('查看当前待验证版本日志')).toBeUndefined();
});

test('告警或订阅失败显示未确认而不是空记录，另一块仍可用；错项目记录不混入', async () => {
  const f = alertsFixture(); f.state.failAlerts = true; page = await renderApp(`${route}&alertId=${alertId}`);
  expect(page.text()).toContain('读取告警失败'); expect(page.text()).not.toContain('最近记录中没有告警'); expect(page.text()).toContain('王负责人');
  // 2026-09-23 裁定：没有刷新按钮，告警与订阅每 5 秒自动重读；reread 模拟一次自动重读。
  expect(button('刷新告警')).toBeUndefined(); expect(button('刷新订阅')).toBeUndefined();
  f.state.failAlerts = false; f.state.wrongProject = true; await page.reread(); expect(page.text()).toContain('返回记录与当前项目不一致');
  f.state.wrongProject = false; await page.reread(); f.state.failSubscriptions = true; await page.reread(); expect(page.text()).toContain('读取订阅失败'); expect(page.text()).not.toContain('尚未配置通知订阅'); expect(page.text()).toContain('preview 健康未通过');
});

test('成员选择自动填入 ID，完整字段约束和同时错误；失败保留草稿，保存不宣称送达', async () => {
  const f = alertsFixture(); page = await renderApp(route); await click('添加订阅'); await input('alertChannel', 'webhook');
  expect(page.text()).toContain('36 字符 UUIDv7'); expect(page.text()).toContain('最多 2048 字符'); await input('alertUserId', 'not-a-user'); await input('alertTarget', 'ftp://example.test'); await click('检查订阅配置');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2); expect(document.activeElement?.getAttribute('name')).toBe('alertUserId'); expect(f.writes).toHaveLength(0);
  await input('alertMember', memberId); await input('alertTarget', 'https://notice.example.test/hook'); expect(document.querySelector<HTMLInputElement>('[name="alertUserId"]')?.value).toBe(memberId);
  await click('检查订阅配置'); expect(page.text()).toContain('陈开发 · dev@test.invalid'); f.state.failSave = true; await click('确认保存订阅'); expect(page.text()).toContain('保存订阅失败'); expect(document.querySelector<HTMLInputElement>('[name="alertTarget"]')?.value).toBe('https://notice.example.test/hook');
  f.state.failSave = false; await click('检查订阅配置'); await click('确认保存订阅'); expect(f.writes.at(-1)).toEqual({ method: 'PUT', path: `/v1/projects/${projectId}/alert-subscriptions`, body: { userId: memberId, channel: 'webhook', target: 'https://notice.example.test/hook' } });
  expect(page.text()).toContain('订阅配置已保存；通知送达未验证'); expect(f.reads.every((path) => path.startsWith('/v1/'))).toBe(true);
});

test('具名移除可取消；确认时记录变化阻止删除，重新检查后仅删除目标订阅', async () => {
  const f = alertsFixture(); page = await renderApp(route); await click('移除 王负责人 · owner@test.invalid'); await click('取消'); expect(f.writes).toHaveLength(0);
  await click('移除 王负责人 · owner@test.invalid'); f.state.subscriptions[0]!.channel = 'webhook'; f.state.subscriptions[0]!.target = 'https://changed.example.test/hook'; await page.reread();
  expect(button('确认移除订阅')?.disabled).toBe(true); expect(page.text()).toContain('订阅记录已变化'); await click('取消'); await click('移除 王负责人 · owner@test.invalid'); await click('确认移除订阅');
  expect(f.writes).toEqual([{ method: 'DELETE', path: `/v1/projects/${projectId}/alert-subscriptions/${ownerId}`, body: {} }]); expect(page.text()).toContain('告警记录仍保留'); expect(page.text()).toContain('preview 健康未通过');
});

test('取消只关窗、草稿留着，筛选后再点「添加订阅」恢复；换编辑别人先确认、「继续编辑当前配置」回到草稿；切诊断页签先确认', async () => {
  const f = alertsFixture(); page = await renderApp(route); await click('添加订阅'); await input('alertMember', memberId); await input('alertChannel', 'webhook'); await input('alertTarget', 'https://draft.example.test');
  // 2026-09-23 起订阅配置是弹窗：取消只关窗，草稿静默留着，再点同一个入口恢复。
  await click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0); await click('已恢复'); await click('添加订阅');
  expect(document.querySelector<HTMLInputElement>('[name="alertTarget"]')?.value).toBe('https://draft.example.test');
  await click('取消'); await click('编辑 王负责人 · owner@test.invalid'); await click('继续编辑当前配置');
  expect(document.querySelectorAll('dialog[open]').length).toBe(1); expect(document.querySelector<HTMLInputElement>('[name="alertUserId"]')?.value).toBe(memberId); await click('取消');
  await click('日志'); expect(page.text()).toContain('未保存'); await click('继续编辑'); expect(page.search().tab).toBe('alerts');
  await click('日志'); await click('放弃输入并离开'); expect(page.search().tab).toBe('logs'); expect(f.writes).toHaveLength(0);
});

test('检查后更改渠道不夹带旧地址，保存替换当前用户配置；离开后的回执不跨页导航', async () => {
  const f = alertsFixture(); f.state.subscriptions[0]!.channel = 'webhook'; f.state.subscriptions[0]!.target = 'https://old.example.test'; page = await renderApp(route);
  await click('编辑 王负责人 · owner@test.invalid'); expect(document.querySelector<HTMLInputElement>('[name="alertUserId"]')?.disabled).toBe(true); await input('alertChannel', 'workbench'); await click('检查订阅配置');
  expect(page.text()).toContain('原订阅'); let resolve!: () => void; f.state.hold = new Promise<void>((done) => { resolve = done; });
  await act(async () => { button('确认保存订阅')!.click(); button('确认保存订阅')!.click(); }); await page.settle(); expect(f.writes).toHaveLength(1); expect(f.writes[0]?.body).toEqual({ userId: ownerId, channel: 'workbench' });
  await click('日志'); await click('放弃输入并离开'); await act(async () => resolve()); await page.settle(); expect(page.search().tab).toBe('logs');
});

test('成员目录失败可手动填写完整 ID；保存后列表读取失败不冒充无订阅', async () => {
  const f = alertsFixture(); f.state.failMembers = true; page = await renderApp(route); await click('添加订阅'); expect(page.text()).toContain('读取成员失败'); await input('alertUserId', memberId); await click('检查订阅配置');
  f.state.failSubscriptions = true; await click('确认保存订阅'); expect(page.text()).toContain('订阅配置已保存'); expect(page.text()).toContain('读取订阅失败'); expect(page.text()).not.toContain('尚未配置通知订阅');
});

test('开发者仅查看，管理员保留管理空间的告警与日志定位', async () => {
  const f = alertsFixture(); f.state.role = 'developer'; page = await renderApp(route); expect(button('添加订阅')).toBeUndefined(); expect(button('移除 王负责人 · owner@test.invalid')).toBeUndefined(); expect(page.text()).toContain('preview 健康未通过');
  page.unmount(); f.state.admin = true; page = await renderApp(`/admin/integrations/${projectId}/operations?tab=alerts&alertId=${alertId}`); expect(button('添加订阅')).toBeDefined(); await click('查看当前待验证版本日志'); expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'preview' }); expect(f.writes).toHaveLength(0);
});
