import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { PlatformRole, UserDto } from '@crewstation/contracts';
import { renderApp } from './renderApp';
import { setIdentityField as field, clickIdentitySelector } from './identityUiHelpers';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const admin = { id: `01a0bf5d-8f4b-7210-80c1-302ae945a98e` as UserDto['id'], name: '同名用户', email: 'admin@example.test', platformRole: 'admin' as PlatformRole, isAdmin: true };
  const member = { id: `01a0bf5d-8f4b-717e-8a21-b101ac0173b2` as UserDto['id'], name: '同名用户', email: 'member@example.test', platformRole: 'user' as PlatformRole, isAdmin: false };
  const developer = { id: `01a0bf5d-8f4b-724c-8db6-5ac36a878a7d` as UserDto['id'], name: 'Developer with a long name', email: 'developer@example.test', platformRole: 'developer' as PlatformRole, isAdmin: false };
  const state = { items: [admin, member, developer], failRead: false, failSave: '', status: 409, writes: [] as Array<{ id: string; body: { platformRole: PlatformRole; expectedRole: PlatformRole } }>, meReads: 0 };
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/v1/me') { state.meReads++; return Response.json({ ...admin, memberships: [], authMethod: 'oidc' }); }
    if (path === '/v1/users') return state.failRead ? Response.json({ error: 'unavailable', message: '目录读取失败' }, { status: 503 }) : Response.json({ items: state.items });
    if (path.endsWith('/platform-role')) {
      const id = path.split('/')[3]!, body = JSON.parse(String(init?.body)); state.writes.push({ id, body });
      if (state.failSave) return Response.json({ error: 'conflict', message: state.failSave }, { status: state.status });
      const user = state.items.find((item) => item.id === id)!; Object.assign(user, { platformRole: body.platformRole, isAdmin: body.platformRole === 'admin' }); return Response.json(user);
    }
    return Response.json({ items: [] });
  }) as typeof fetch;
  return { state, admin, member, developer };
}

/** 鼠标点按钮会先让它获得焦点，程序化 click 不会；弹窗关闭后焦点回到打开它的按钮，所以先聚焦再点。 */
async function openUser(email: string) { const button = document.querySelector<HTMLButtonElement>(`button[aria-label*="${email}"]`)!; await act(async () => { button.focus(); button.click(); }); await page!.settle(); }
async function openMember() { await openUser('member@example.test'); }
async function choose(role: PlatformRole) { await clickIdentitySelector(`input[type="radio"][value="${role}"]`); }

test('用户默认仅目录，按 ID 标记自己；组合搜索和角色过滤，与无匹配状态分开', async () => {
  const f = fixture(); page = await renderApp('/admin/users');
  expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  expect(document.querySelectorAll('button[aria-label^="管理"]')).toHaveLength(3);
  const own = document.querySelector('button[aria-label*="admin@example.test"]')!.parentElement!;
  expect(own.textContent).toContain('你'); expect(document.querySelector('button[aria-label*="member@example.test"]')!.parentElement!.textContent).not.toContain('你');
  await field('查找用户', 'EXAMPLE.TEST'); await field('平台角色', 'developer');
  expect(document.querySelectorAll('button[aria-label^="管理"]')).toHaveLength(1); expect(page.text()).toContain(f.developer.name);
  await field('查找用户', '没有此人'); expect(page.text()).toContain('没有匹配的用户'); expect(page.text()).not.toContain('还没有用户');
  await page.click('清除筛选'); expect(document.querySelectorAll('button[aria-label^="管理"]')).toHaveLength(3);
});

// 2026-09-23 起角色在弹窗里改：取消只关窗、选择留着，再点同一位用户恢复；清空回到当前角色；焦点回到打开它的按钮。
test('单人编辑保留筛选、完整身份和关闭焦点；选择与取消不发送写请求', async () => {
  const f = fixture(); page = await renderApp('/admin/users'); await field('查找用户', 'member'); await openMember();
  expect(document.querySelector('dialog[open]')?.textContent).toContain(f.member.id); expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  expect((document.activeElement as HTMLInputElement).value).toBe('user'); await choose('developer'); expect(f.state.writes).toEqual([]);
  await page.click('检查变更'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('用户→开发者'); await page.click('取消');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); await page.click('取消');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect(document.activeElement?.getAttribute('aria-label')).toContain('member@example.test');
  expect(document.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('member'); expect(f.state.writes).toEqual([]);
  await openMember(); expect(document.querySelector<HTMLInputElement>('input[value="developer"]')?.checked).toBe(true);
  await page.click('清空'); expect(document.querySelector<HTMLInputElement>('input[value="user"]')?.checked).toBe(true); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(f.state.writes).toEqual([]);
});

// 改了没保存时去改另一位：先确认；继续编辑回到原来那份，放弃才换人。
test('有未保存的角色选择时去管理另一位先确认，继续编辑回到原选择', async () => {
  const f = fixture(); page = await renderApp('/admin/users'); await openMember(); await choose('admin'); await page.click('取消');
  await openUser('developer@example.test'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('同名用户 的角色有未保存的输入');
  await page.click('继续编辑'); expect(document.querySelector('dialog[open]')?.textContent).toContain('member@example.test'); expect(document.querySelector<HTMLInputElement>('input[value="admin"]')?.checked).toBe(true);
  await page.click('取消'); await openUser('developer@example.test'); await page.click('放弃输入并离开');
  expect(document.querySelector('dialog[open]')?.textContent).toContain(f.developer.id); expect(document.querySelector<HTMLInputElement>('input[value="developer"]')?.checked).toBe(true);
  expect(f.state.writes).toEqual([]);
});

test('缺少邮箱的同名账号明确说明缺失，编辑入口用完整 ID 消歧', async () => {
  const f = fixture(); f.member.email = ''; page = await renderApp('/admin/users');
  expect(page.text()).toContain('未提供邮箱');
  await clickIdentitySelector(`button[aria-label*="${f.member.id}"]`); await page.settle();
  expect(page.text()).toContain(f.member.id); expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  expect(document.querySelector('input[value="user"]')?.getAttribute('name')).toBe(`role-${f.member.id}`);
});

test('角色 409 保留草稿；重读失败保持旧基准，成功后必须再次确认且发送新 expectedRole', async () => {
  const f = fixture(); page = await renderApp('/admin/users'); await openMember(); await choose('developer');
  f.state.failSave = '角色已经变更'; await page.click('检查变更'); await page.click('保存角色');
  expect(page.text()).toContain('角色已经变更'); expect(document.querySelector<HTMLInputElement>('input[value="developer"]')?.checked).toBe(true);
  expect(f.state.writes[0]?.body).toEqual({ platformRole: 'developer', expectedRole: 'user' });
  f.state.failRead = true; await page.click('重新读取当前角色'); expect(page.text()).toContain('目录读取失败');
  f.member.platformRole = 'admin'; f.member.isAdmin = true; f.state.failRead = false; f.state.failSave = '';
  await page.click('重新读取当前角色'); expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(f.state.writes).toHaveLength(1);
  await page.click('检查变更'); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('管理员→开发者'); await page.click('保存角色');
  expect(f.state.writes.at(-1)?.body).toEqual({ platformRole: 'developer', expectedRole: 'admin' }); expect(f.state.meReads).toBeGreaterThan(1); expect(document.querySelector('input[type="radio"]')).toBeNull();
});

test('最后管理员或负责人拒绝原因原文显示，不制造成功状态', async () => {
  const f = fixture(); f.state.status = 403; f.state.failSave = '请先转交项目负责人'; page = await renderApp('/admin/users'); await openMember(); await choose('developer'); await page.click('检查变更'); await page.click('保存角色');
  expect(page.text()).toContain('请先转交项目负责人'); expect(page.text()).toContain('HTTP 403'); expect(document.querySelector('input[type="radio"]')).not.toBeNull();
});

test('用户目录加载、失败重试与真正空目录独立；本人角色保存后触发原有管理守卫', async () => {
  const f = fixture(); const base = globalThis.fetch; let release: (() => void) | undefined;
  globalThis.fetch = (async (input, init) => {
    if (String(input).endsWith('/users')) await new Promise<void>((resolve) => { release = resolve; });
    return base(input, init);
  }) as typeof fetch;
  page = await renderApp('/admin/users'); expect(page.text()).toContain('载入'); expect(page.text()).not.toContain('还没有用户');
  f.state.failRead = true; await act(async () => release?.()); await page.settle(); globalThis.fetch = base;
  expect(page.text()).toContain('目录读取失败'); f.state.failRead = false; f.state.items = []; await page.reread(); expect(page.text()).toContain('还没有用户');
  page.unmount(); f.state.items = [f.admin]; page = await renderApp('/admin/users');
  await clickIdentitySelector('button[aria-label*="admin@example.test"]'); await choose('user'); await page.click('检查变更'); await page.click('保存角色');
  expect(page.text()).toContain('管理员'); expect(document.querySelector('input[type="radio"]')).toBeNull();
  expect(f.state.writes.at(-1)?.id).toBe(f.admin.id); expect(f.admin.platformRole).toBe('user');
});
