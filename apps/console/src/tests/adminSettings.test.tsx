import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';

const originalFetch = globalThis.fetch;
const adminId = '01a0bf5d-8f4b-7c31-8000-000000000001';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

/** 假服务端：平台设置带版本号，版本对不上 409；非管理员读到 403。 */
function settingsFixture(admin = true) {
  const state = { policy: { rollbackRetentionHours: 72, idleOfflineDays: 14, reminderLeadHours: 24, revision: 0, updatedAt: null as string | null } };
  const writes: Array<Record<string, unknown>> = [], reads: string[] = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let body: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') body = { id: adminId, name: '管理员', email: 'admin@test.invalid', platformRole: admin ? 'admin' : 'developer', isAdmin: admin, memberships: [] };
    else if (path === '/v1/admin/settings/auto-offline' && method === 'GET') { reads.push(path); body = state.policy; }
    else if (path === '/v1/admin/settings/auto-offline') {
      const input = JSON.parse(String(init?.body ?? '{}')) as Record<string, number>; writes.push(input);
      if (input.expectedRevision !== state.policy.revision) { status = 409; body = { error: 'conflict', message: '平台设置已被他人修改，请刷新后重新确认' }; }
      else { const { expectedRevision, ...values } = input; state.policy = { ...state.policy, ...values, revision: expectedRevision! + 1, updatedAt: '2026-09-23T03:00:00.000Z' }; body = state.policy; }
    }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes, reads };
}

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }
const field = (label: string) => [...document.querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label)!.querySelector('input')!;
async function type(label: string, value: string) {
  const input = field(label);
  await act(async () => { input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}

// RFC-021 M11、M12、M22、M28：平台设置页展示三个时长；修改时校验范围与「提醒短于两个周期」，保存带开始修改时的版本号。
test('平台设置：默认值、校验、保存带版本号，保存后显示修改时间', async () => {
  const f = settingsFixture(); page = await renderApp('/admin/settings');
  expect(page.text()).toContain('平台设置'); expect(page.text()).toContain('72 小时'); expect(page.text()).toContain('14 天'); expect(page.text()).toContain('24 小时');
  expect(page.text()).toContain('使用平台默认值，尚未修改过。');
  await click('修改'); expect(field('回退目标保留').value).toBe('72');
  await type('提前提醒', '72'); await click('保存');
  expect(page.text()).toContain('提前提醒的时间必须短于回退目标保留时间。'); expect(f.writes).toHaveLength(0);
  await type('提前提醒', '12'); await type('待验证版本无人访问', '0'); await click('保存');
  expect(page.text()).toContain('无人访问期限要填 1–365 之间的整数（天）。'); expect(f.writes).toHaveLength(0);
  await type('待验证版本无人访问', '7'); await type('回退目标保留', '48'); await click('保存');
  expect(f.writes).toEqual([{ rollbackRetentionHours: 48, idleOfflineDays: 7, reminderLeadHours: 12, expectedRevision: 0 }]);
  expect(page.text()).toContain('已保存，所有项目的到期时间按新时长重新计算。'); expect(page.text()).toContain('48 小时'); expect(page.text()).toContain('最近一次修改于');
});

// 两个管理员同时改：后保存的人拿到 409 与原因，输入保留，不自动重发。
test('平台设置：别人先保存过时 409，说明原因且不重发', async () => {
  const f = settingsFixture(); page = await renderApp('/admin/settings');
  await click('修改'); f.state.policy = { ...f.state.policy, revision: 1 };
  await type('回退目标保留', '96'); await click('保存');
  expect(page.text()).toContain('平台设置已被他人修改，请刷新后重新确认'); expect(f.writes).toHaveLength(1); expect(field('回退目标保留').value).toBe('96');
});

// 2026-09-23 起修改在弹窗里：取消只关窗、改过的输入再点「修改」恢复；清空回到此刻的时长；改过就进离开确认，确认后才丢。
test('平台设置：修改弹窗取消保留输入、清空回到当前值，离开前确认', async () => {
  const f = settingsFixture(); page = await renderApp('/admin/settings');
  const dialogs = () => document.querySelectorAll('dialog[open]').length, top = () => [...document.querySelectorAll('dialog[open]')].at(-1)?.textContent ?? '';
  await click('修改'); expect(top()).toContain('修改自动下线时长'); await type('回退目标保留', '96'); await click('取消');
  expect(dialogs()).toBe(0); expect(page.text()).toContain('72 小时');
  await click('修改'); expect(field('回退目标保留').value).toBe('96');
  await click('清空'); expect(dialogs()).toBe(1); expect(field('回退目标保留').value).toBe('72');
  await type('提前提醒', '12'); await click('取消');
  await page.requestNavigate('/admin/users'); expect(top()).toContain('待验证版本自动下线有未保存的输入'); await click('继续编辑');
  expect(page.path()).toBe('/admin/settings'); expect(dialogs()).toBe(0);
  await page.requestNavigate('/admin/users'); await click('放弃输入并离开'); expect(page.path()).toBe('/admin/users');
  await page.navigate('/admin/settings'); await click('修改'); expect(field('提前提醒').value).toBe('24'); expect(f.writes).toHaveLength(0);
});

// 管理页自己不判权限：非管理员由管理布局的守卫挡住，页面不读平台设置。
test('非管理员进不了平台设置，也不读取它', async () => {
  const f = settingsFixture(false); page = await renderApp('/admin/settings');
  expect(f.reads).toHaveLength(0); expect(button('修改')).toBeUndefined();
});
