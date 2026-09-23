import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { alertId, alertsFixture, projectId } from './alertsFixture';

let page: Awaited<ReturnType<typeof renderApp>> | undefined;
const originalFetch = globalThis.fetch, route = `/projects/${projectId}/operations?tab=alerts`;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }

test('真实告警状态、最近记录筛选和指定详情；槽由结构化字段定位，未知记录不回退到最新', async () => {
  alertsFixture(); page = await renderApp(`${route}&alertId=${alertId}`); expect(page.text()).toContain('只显示最近 100 条'); expect(page.text()).toContain('触发中');
  await click('查看当前待验证版本日志'); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'preview' });
  await page.navigate(`${route}&alertId=old-alert&alertState=resolved`); expect(page.text()).toContain('恢复时间'); expect(page.text()).toContain('没有提供可定位的关联对象'); expect(button('查看当前正式版本日志')).toBeUndefined();
  await page.navigate(`${route}&alertId=missing`); expect(page.text()).toContain('最近 100 条中未找到此告警'); expect(button('查看当前待验证版本日志')).toBeUndefined();
});

test('告警读取失败显示未确认而不是空记录；错项目记录不混入', async () => {
  const f = alertsFixture(); f.state.failAlerts = true; page = await renderApp(`${route}&alertId=${alertId}`);
  expect(page.text()).toContain('读取告警失败'); expect(page.text()).not.toContain('最近记录中没有告警');
  // 2026-09-23 裁定：没有刷新按钮，告警每 5 秒自动重读；reread 模拟一次自动重读。
  expect(button('刷新告警')).toBeUndefined();
  f.state.failAlerts = false; f.state.wrongProject = true; await page.reread(); expect(page.text()).toContain('返回记录与当前项目不一致');
  f.state.wrongProject = false; await page.reread(); expect(page.text()).toContain('preview 健康未通过');
});

// 基线 v0.3.13（D61）删除了项目级告警订阅：负责人和管理员都不再看到订阅卡片，页面也不再读写订阅接口。
test('告警页没有通知订阅：负责人与管理员都看不到「添加订阅」，不请求订阅接口；管理员仍可从告警跳到日志', async () => {
  const f = alertsFixture(); page = await renderApp(route); expect(page.text()).toContain('preview 健康未通过');
  expect(button('添加订阅')).toBeUndefined(); expect(page.text()).not.toContain('通知订阅');
  page.unmount(); f.state.admin = true; page = await renderApp(`/admin/integrations/${projectId}/operations?tab=alerts&alertId=${alertId}`);
  expect(button('添加订阅')).toBeUndefined(); expect(page.text()).not.toContain('通知订阅');
  await click('查看当前待验证版本日志'); expect(page.path()).toBe(`/admin/integrations/${projectId}/operations`); expect(page.search()).toMatchObject({ tab: 'logs', source: 'slot', slot: 'preview' });
  expect(f.reads.some((path) => path.includes('alert-subscriptions'))).toBe(false); expect(f.writes).toHaveLength(0);
});
