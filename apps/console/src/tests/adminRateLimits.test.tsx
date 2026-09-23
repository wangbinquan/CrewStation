import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { computeProjectId } from './projectComputeFixture';
import { projectResourcesFixture, resourcePagePath } from './adminProjectResourcesFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

const bucket = (average: number, burst: number) => ({ average, burst });
const defaults = {
  platformApi: { perUser: bucket(20, 40), inFlightPerUser: 16 },
  userDomain: { perUser: bucket(30, 60), perHost: bucket(300, 600) },
  serviceDomain: { perSource: bucket(50, 100), perTarget: bucket(500, 1000) },
};
const projectPath = `/v1/admin/projects/${computeProjectId}/rate-limits`;

/** 假服务端：平台默认与项目覆盖都带版本号，版本对不上 409（RFC-025 T10）。 */
function rateLimitFixture() {
  projectResourcesFixture();
  const fallback = globalThis.fetch;
  const state = {
    platform: { ...defaults, revision: 0, updatedAt: null as string | null },
    project: { projectId: computeProjectId, override: null as Record<string, unknown> | null, effective: { userDomain: defaults.userDomain, serviceDomain: defaults.serviceDomain }, revision: 0, updatedAt: null as string | null },
  };
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const path = new URL(String(input), 'http://localhost').pathname, method = init?.method ?? 'GET';
    if (path !== '/v1/admin/settings/rate-limits' && path !== projectPath) return fallback(input, init);
    if (method === 'GET') return Response.json(path === projectPath ? state.project : state.platform);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>; writes.push({ path, body });
    const current = path === projectPath ? state.project : state.platform;
    if (body['expectedRevision'] !== current.revision) return Response.json({ error: 'conflict', message: '限流设置已被他人修改，请刷新后重新确认' }, { status: 409 });
    if (path === projectPath) {
      const override = body['override'] as Record<string, unknown> | null;
      state.project = { ...state.project, override, effective: { userDomain: (override?.['userDomain'] ?? defaults.userDomain) as typeof defaults.userDomain, serviceDomain: (override?.['serviceDomain'] ?? defaults.serviceDomain) as typeof defaults.serviceDomain }, revision: override ? state.project.revision + 1 : 0, updatedAt: override ? '2026-09-24T01:00:00.000Z' : null };
      return Response.json(state.project);
    }
    const { expectedRevision, ...limits } = body;
    state.platform = { ...state.platform, ...(limits as typeof defaults), revision: (expectedRevision as number) + 1, updatedAt: '2026-09-24T01:00:00.000Z' };
    return Response.json(state.platform);
  }) as typeof fetch;
  return { state, writes };
}

const card = (title: string) => [...document.querySelectorAll('section')].find((node) => node.querySelector('h2')?.textContent === title)!;
async function clickIn(scope: ParentNode, label: string) {
  const target = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent === label);
  expect(target).toBeDefined(); await act(async () => target!.click()); await page!.settle();
}
const dialog = () => [...document.querySelectorAll('dialog[open]')].at(-1)!;
const field = (label: string) => [...dialog().querySelectorAll('label')].find((node) => node.querySelector('span')?.textContent === label)!.querySelector<HTMLInputElement | HTMLSelectElement>('input,select')!;
async function type(label: string, value: string) {
  const node = field(label) as HTMLInputElement;
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function choose(label: string, value: string) {
  const node = field(label) as HTMLSelectElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('change', { bubbles: true })); });
  await page!.settle();
}

// RFC-025 T10：平台设置里的网关限流——三组现值；突发小于平均不提交；保存带开始修改时的版本号，别人先保存过是 409。
test('网关限流（平台默认）：展示三组、校验突发不能小于平均、保存带版本号；409 说明原因不重发', async () => {
  const f = rateLimitFixture(); page = await renderApp('/admin/settings');
  const limits = card('网关限流');
  for (const text of ['平台接口（工作台与命令行）', '平均 20 次／秒 · 突发 40', '同时 16 个', '每个目标合计', '平均 500 次／秒 · 突发 1000', '使用平台内置的默认值，尚未修改过。']) expect(limits.textContent).toContain(text);
  await clickIn(limits, '修改');
  expect((field('每个用户 · 平均') as HTMLInputElement).value).toBe('20');
  await type('每个主机合计 · 突发', '100'); await clickIn(dialog(), '保存');
  expect(dialog().textContent).toContain('突发不能小于平均。'); expect(f.writes).toHaveLength(0);
  await type('每个主机合计 · 突发', '800'); await type('每个用户 · 同时处理', '32'); await clickIn(dialog(), '保存');
  expect(f.writes).toEqual([{ path: '/v1/admin/settings/rate-limits', body: { ...defaults, platformApi: { ...defaults.platformApi, inFlightPerUser: 32 }, userDomain: { ...defaults.userDomain, perHost: bucket(300, 800) }, expectedRevision: 0 } }]);
  expect(card('网关限流').textContent).toContain('已保存，几秒内网关按新值限流。'); expect(card('网关限流').textContent).toContain('同时 32 个'); expect(card('网关限流').textContent).toContain('最近一次修改于');
  // 另一位管理员先保存过：409，原因写在弹窗里，不重发。
  await clickIn(card('网关限流'), '修改'); f.state.platform = { ...f.state.platform, revision: 5 };
  await type('每个用户 · 平均', '10'); await clickIn(dialog(), '保存');
  expect(dialog().textContent).toContain('限流设置已被他人修改，请刷新后重新确认'); expect(f.writes).toHaveLength(2);
});

// 项目管理页：每组默认照平台设置，可以单独设置一组；撤销后回到平台默认。
test('项目的限流：标出平台默认或单独设置；只单独设置用户域时只提交那一组；撤销单独设置回到平台默认', async () => {
  const f = rateLimitFixture(); page = await renderApp(resourcePagePath);
  const limits = card('限流');
  expect(limits.textContent).toContain('用户域（数字人的正式与待验证主机） · 平台默认'); expect(limits.textContent).toContain('服务域（内部 API、数字人互调、事件推送） · 平台默认');
  expect([...limits.querySelectorAll('button')].some((node) => node.textContent === '撤销单独设置')).toBe(false);
  await clickIn(limits, '修改');
  await choose('用户域（数字人的正式与待验证主机）', 'override');
  await type('每个用户在每个主机 · 平均', '5'); await type('每个用户在每个主机 · 突发', '10'); await clickIn(dialog(), '保存');
  expect(f.writes).toEqual([{ path: projectPath, body: { override: { userDomain: { perUser: bucket(5, 10), perHost: bucket(300, 600) } }, expectedRevision: 0 } }]);
  const after = card('限流');
  expect(after.textContent).toContain('用户域（数字人的正式与待验证主机） · 单独设置'); expect(after.textContent).toContain('平均 5 次／秒 · 突发 10'); expect(after.textContent).toContain('已保存，几秒内网关按新值限流。');
  await clickIn(after, '撤销单独设置'); await clickIn(card('限流'), '确认');
  expect(f.writes.at(-1)).toEqual({ path: projectPath, body: { override: null, expectedRevision: 1 } });
  expect(card('限流').textContent).toContain('已撤销，这个项目回到平台默认。'); expect(card('限流').textContent).toContain('用户域（数字人的正式与待验证主机） · 平台默认');
});

// 其他页面的用例的假服务端对没登记的接口回 `{ items: [] }`：限流卡不能拿它当设置渲染、把整页带崩。
test('限流设置的回执形状不对：当读取失败显示，页面照常可用', async () => {
  projectResourcesFixture();
  page = await renderApp('/admin/settings');
  expect(card('网关限流').textContent).toContain('稍后会自动重新读取。');
  expect([...card('网关限流').querySelectorAll('button')].some((node) => node.textContent === '修改')).toBe(false);
});
