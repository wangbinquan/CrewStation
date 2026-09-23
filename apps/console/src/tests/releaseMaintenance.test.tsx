import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { guestId, projectId, serviceId, slotLifecycleFixture } from './slotLifecycleFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
async function click(label: string) { expect(button(label)).toBeDefined(); await act(async () => button(label)!.click()); await page!.settle(); }
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  // happy-dom 下 React 走输入事件的兼容路径，要补一个 keyup 才读到新值（与 releaseDelivery 用例同一做法）。
  await act(async () => { field.focus(); Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
const reason = () => document.querySelector<HTMLTextAreaElement>('[name="maintenanceReason"]')!;
const end = () => document.querySelector<HTMLInputElement>('[name="maintenanceEnd"]')!;
const box = (key: string) => document.querySelector<HTMLInputElement>(`[name="maintenance-${key}"]`)!;
const prodCard = () => [...document.querySelectorAll('section')].find((node) => node.querySelector('h2')?.textContent === '正式版本')?.textContent ?? '';
const localInput = (date: Date) => { const pad = (n: number) => String(n).padStart(2, '0'); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };

// RFC-021 M4、M6、M7、M13、B1：三个开关默认全开，原因必填，预计恢复时间要晚于现在；临时放行的人按账号精确查询加入。
test('进入维护：默认三个开关全开，原因必填、时间不能早于现在；带上临时放行的人与版本 0', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  await click('进入维护');
  expect(['users', 'services', 'events'].map((key) => box(key).checked)).toEqual([true, true, true]);
  await click('确认进入维护'); expect(page.text()).toContain('请填写维护原因。'); expect(document.activeElement).toBe(reason()); expect(f.writes).toHaveLength(0);
  await type(reason(), '  迁移订单表  '); await type(end(), localInput(new Date(Date.now() - 3_600_000)));
  await click('确认进入维护'); expect(page.text()).toContain('预计恢复时间要晚于现在。'); expect(document.activeElement).toBe(end()); expect(f.writes).toHaveLength(0);
  const later = new Date(Date.now() + 2 * 3_600_000); later.setSeconds(0, 0); await type(end(), localInput(later));
  const lookup = document.querySelector<HTMLInputElement>('[role="group"][aria-label="临时放行的人"] input')!; await type(lookup, 'guest@test.invalid');
  await click('查找账号'); await click('放行'); expect(page.text()).toContain('访客 · guest@test.invalid');
  await click('确认进入维护');
  expect(f.writes).toEqual([{ method: 'PUT', path: `/v1/services/${serviceId}/maintenance`, body: { switches: { users: true, services: true, events: true }, allowUserIds: [guestId], reason: '迁移订单表', expectedEndAt: later.toISOString(), expectedRevision: 0 } }]);
  expect(page.text()).toContain('正式版本已进入维护'); expect(page.text()).toContain('正式版本维护中');
  expect(prodCard()).toContain('维护中：迁移订单表'); expect(prodCard()).toContain('预计'); expect(button('进入维护')).toBeUndefined();
  expect(page.text()).toContain('项目成员、平台管理员、访客'); expect(page.text()).toContain('可以发布或上线含破坏性迁移的版本'); expect(page.text()).toContain('维护暂存');
  expect(page.text()).toContain('负责人 让正式版本进入维护');
});

// 调整带上打开表单时的版本号；关掉事件开关后不再是破坏性迁移窗口。退出要行内确认，带版本号。
test('调整维护带当时的版本号并保留原值；退出维护要确认，之后恢复为「进入维护」', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  await click('进入维护'); await type(reason(), '换库'); await click('确认进入维护');
  await click('调整'); expect(reason().value).toBe('换库'); await act(async () => box('events').click()); await page.settle();
  await click('保存调整');
  expect(f.writes[1]).toEqual({ method: 'PUT', path: `/v1/services/${serviceId}/maintenance`, body: { switches: { users: true, services: true, events: false }, allowUserIds: [], reason: '换库', expectedEndAt: null, expectedRevision: 1 } });
  expect(page.text()).toContain('已保存维护调整'); expect(page.text()).not.toContain('可以发布或上线含破坏性迁移的版本'); expect(page.text()).toContain('负责人 调整了维护');
  await click('退出维护'); expect(page.text()).toContain('暂存的事件按接收顺序补发'); await click('确认退出维护');
  expect(f.writes[2]).toEqual({ method: 'POST', path: `/v1/services/${serviceId}/maintenance/exit`, body: { expectedRevision: 2 } });
  expect(page.text()).toContain('已退出维护'); expect(page.text()).not.toContain('正式版本维护中'); expect(button('进入维护')).toBeDefined();
});

// 他人先改过时 409：说明原因、保留输入、不自动重发。未提交的维护表单进离开确认。
test('保存被拒绝时保留输入；未提交的维护表单离开前要确认', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  await click('进入维护'); await type(reason(), '紧急修复'); f.state.fail = { status: 409, message: '维护状态已被他人修改，请刷新后重新确认' };
  await click('确认进入维护'); expect(page.text()).toContain('维护状态已被他人修改'); expect(reason().value).toBe('紧急修复'); expect(f.writes).toHaveLength(1);
  await page.requestNavigate(`/projects/${projectId}`); expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
  await click('继续编辑'); expect(reason().value).toBe('紧急修复');
});

// 2026-09-23 作者裁定页内展开的表单改弹窗：取消、✕、Esc 只关窗，草稿留在页面上、再打开恢复；「清空」回到此刻的维护状态；
// 离开本页才丢，离开确认写明是「维护设置」。
test('维护弹窗关掉不丢输入、再打开恢复；清空回到初始值；离开前的确认写明维护设置', async () => {
  const f = slotLifecycleFixture(); page = await renderApp(`/projects/${projectId}/release`);
  const enter = button('进入维护')!; enter.focus(); await click('进入维护');
  expect(document.querySelectorAll('dialog[open]').length).toBe(1); expect(document.activeElement === box('users')).toBe(true);
  await type(reason(), '换库'); await act(async () => box('events').click()); await page.settle();
  await click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0); expect(document.activeElement === button('进入维护')).toBe(true);
  await click('进入维护'); expect(reason().value).toBe('换库'); expect(box('events').checked).toBe(false);
  await click('清空'); expect(reason().value).toBe(''); expect(box('events').checked).toBe(true); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  await type(reason(), '换库'); await act(async () => { document.querySelector('dialog[open]')!.dispatchEvent(new Event('cancel', { cancelable: true })); }); await page.settle();
  expect(document.querySelectorAll('dialog').length).toBe(0);
  await page.requestNavigate(`/projects/${projectId}`); expect(page.text()).toContain('维护设置有未保存的输入'); await click('放弃输入并离开');
  expect(page.path()).toBe(`/projects/${projectId}`); expect(f.writes).toHaveLength(0);
});

// M8：开发者看得到维护的事实，但没有进入、调整与退出。
test('开发者看得到维护中的开关、原因与放行名单，没有任何维护动作', async () => {
  const f = slotLifecycleFixture('developer');
  f.state.maintenance = { serviceId, projectId, switches: { users: true, services: false, events: false }, allowUsers: [], reason: '对账', startedBy: guestId, startedAt: new Date().toISOString(), updatedBy: guestId, updatedAt: new Date().toISOString(), revision: 1 } as never;
  page = await renderApp(`/projects/${projectId}/release`);
  expect(page.text()).toContain('正式版本维护中'); expect(page.text()).toContain('用户访问'); expect(page.text()).not.toContain('服务域调用、'); expect(page.text()).toContain('由项目负责人或平台管理员调整与退出维护。');
  for (const label of ['进入维护', '调整', '退出维护']) expect(button(label)).toBeUndefined();
  expect(prodCard()).toContain('维护中：对账');
});
