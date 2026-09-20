import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { browserHistoryFixture } from './browserHistoryFixture';

const originalFetch = globalThis.fetch, projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', userId = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { failSave: false, failRead: false, failVersions: false, failIdentity: false, role: 'owner' as 'owner' | 'developer', admin: false, hold: undefined as Promise<void> | undefined };
  const writes: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const item = { id: '01a0bf5d-8f4b-741b-855a-427597babed5', definitionId: '01a0bf5d-8f4b-712d-84fa-c34dfa1810f3', bindingName: 'GREETING', name: 'GREETING', value: '当前值', isSecret: false, version: 3, env: 'development', updatedBy: userId, updatedAt: '2026-09-13T01:00:00.000Z' };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') {
      const input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; writes.push({ path, method, body: input });
      if (state.hold) await state.hold;
      if (state.failSave) { status = 503; body = { error: 'unavailable', message: '配置服务暂不可用' }; }
      else if (method === 'DELETE') return new Response(null, { status: 204 });
      else body = { ...item, ...input, version: 4 };
    } else if (path === '/v1/me') {
      if (state.failIdentity) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: userId, name: '当前成员', email: 'member@test.invalid', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, memberships: [{ projectId, role: state.role }] };
    }
    else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, slug: 'demo', name: '演示应用', kind: 'DigitalWorker', ownerUserId: userId, state: 'active' };
    else if (/\/config\/(development|production)$/.test(path)) {
      if (state.failRead) { status = 503; body = { error: 'unavailable', message: '配置读取失败' }; }
      else body = { items: [{ ...item, env: path.endsWith('production') ? 'production' : 'development' }, { ...item, id: '01a0bf5d-8f4b-795e-8427-5e5540ef37fa', definitionId: '01a0bf5d-8f4b-7cd5-8fa7-42c6e13d2afb', bindingName: 'API_TOKEN', name: 'API_TOKEN', isSecret: true, value: undefined }] };
    } else if (path.endsWith('/versions') && state.failVersions) { status = 503; body = { error: 'unavailable', message: '历史服务暂不可用' }; }
    else if (path.endsWith('/dev-session')) { status = 404; body = { error: 'not_found', message: '无会话' }; }
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, writes };
}

const visible = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)].find((element) => !element.closest('[hidden]'))!;
async function input(node: HTMLInputElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); });
  await page!.settle();
}
async function click(label: string) {
  if (label === '保存') label = `保存到${page!.search().env === 'production' ? '生产' : '开发'}`;
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((element) => !element.closest('[hidden]') && element.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => { button.click(); }); await page!.settle();
}

test('真实开发者可编辑开发组；生产组只读且不显示保存、填入或删除入口', async () => {
  const f = fixture(); f.state.role = 'developer'; page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`);
  // 实机普通开发者看到了“负责人维护”下仍可输入和保存的生产表单。
  expect(visible('input[placeholder="DATABASE_URL"]') === undefined).toBe(true);
  expect(page.text()).toContain('只有项目负责人或管理员可以修改生产');
  expect([...document.querySelectorAll('button')].filter((node) => !node.closest('[hidden]')).map((node) => node.textContent)).not.toContain('修改');
  expect([...document.querySelectorAll('button')].filter((node) => !node.closest('[hidden]')).map((node) => node.textContent)).not.toContain('删除');
  expect(page.text()).toContain('当前值'); expect(page.text()).toContain('••••••••');
  await click('开发'); await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_ALLOWED'); await click('保存');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]?.path).toBe(`/v1/projects/${projectId}/config/development`);
});

test('管理员仍可维护生产组；身份刷新失败保护草稿并禁写，恢复后可继续', async () => {
  const f = fixture(); f.state.role = 'developer'; f.state.admin = true; page = await renderApp(`/projects/${projectId}/settings?tab=config&env=production`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'ADMIN_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '保留的生产草稿'); f.state.failIdentity = true; await click('刷新配置');
  expect(page.text()).toContain('身份读取失败');
  const draft = document.querySelector<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]')!;
  expect(draft.value).toBe('保留的生产草稿'); expect(draft.closest('[hidden]')).not.toBeNull();
  await act(async () => { draft.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await page.settle(); expect(f.writes).toHaveLength(0);
  f.state.failIdentity = false; await click('重新检查权限'); await click('保存');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]?.path).toBe(`/v1/projects/${projectId}/config/production`);
});

test('配置保存失败保留值；成功后才清空输入并反馈真实版本和生效条件', async () => {
  const f = fixture(); f.state.failSave = true; page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'NEW_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '需要保留的内容'); await click('保存');
  // 原实现调用 onSubmit 后立即 setValue('')，503 时用户输入已被丢弃。
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('需要保留的内容');
  expect(page.text()).toContain('配置服务暂不可用'); f.state.failSave = false; await click('保存');
  expect(visible('input[placeholder="写入后生效于下一次注入"]')).toBeUndefined();
  expect(page.text()).toContain('第 4 版'); expect(page.text()).toContain('现有进程不会自动加载');
  expect(f.writes.at(-1)?.body).toEqual({ bindingName: 'NEW_VALUE', name: 'NEW_VALUE', value: '需要保留的内容', isSecret: false, env: 'development' });
});

test('键名规则与空值语义首屏可见；非法键有字段反馈并聚焦，空字符串是有效写入', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  expect(page.text()).toContain('大写字母开头'); expect(page.text()).toContain('留空保存会写入空值');
  const key = visible<HTMLInputElement>('input[placeholder="DATABASE_URL"]');
  await input(key, 'wrong-key'); await click('保存'); expect(f.writes).toHaveLength(0);
  expect(key.getAttribute('aria-invalid')).toBe('true'); expect(document.activeElement === key).toBe(true);
  await input(key, 'EMPTY_VALUE'); await click('保存'); expect(f.writes[0]?.body).toMatchObject({ name: 'EMPTY_VALUE', value: '' });
});

test('填入普通键保留可读值，密钥不预填；两组失败草稿各自保留', async () => {
  const f = fixture(); f.state.failSave = true; page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await click('修改'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  expect(page.html()).toContain('01a0bf5d-8f4b-741b-855a-427597babed5');
  const secretRow = [...document.querySelectorAll<HTMLTableRowElement>('tr')].find((row) => !row.closest('[hidden]') && row.textContent?.includes('API_TOKEN'))!;
  await act(async () => { secretRow.querySelector('button')!.click(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe(''); expect(page.text()).toContain('旧密钥无法读回');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '开发草稿'); await click('保存');
  await page.click('生产'); await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'PRODUCTION_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '生产草稿'); await click('保存');
  expect(f.writes.at(-1)?.path).toBe(`/v1/projects/${projectId}/config/production`);
  await click('开发'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('开发草稿');
  await page.click('生产'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('生产草稿');
});

test('保存进行中防止清空、切编辑项、重复保存与删除；暂时读取失败保留输入且可恢复', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'EDIT_VALUE'); await input(visible('input[placeholder="写入后生效于下一次注入"]'), '草稿');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  await click('保存'); await click('保存中…'); await click('取消编辑'); await click('修改'); await click('删除');
  expect(f.writes).toHaveLength(1); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('草稿');
  await act(async () => { finish(); }); await page.settle(); f.state.hold = undefined; await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'SECOND_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '未提交的新内容'); f.state.failRead = true; await click('刷新配置');
  expect(page.text()).toContain('配置读取失败'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('未提交的新内容');
  await click('保存'); expect(f.writes).toHaveLength(1);
  f.state.failRead = false; f.state.failVersions = true; await click('刷新配置'); expect(page.text()).toContain('历史服务暂不可用');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').disabled).toBe(false); await click('保存'); expect(f.writes).toHaveLength(2);
});

test('编辑另一配置或离开设置前可保留未保存输入，确认放弃后才跳转', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DRAFT_KEY');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '不可丢的草稿'); await click('修改');
  // 旧界面直接换 key 重挂表单，未保存值随组件被销毁。
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿');
  await click('继续编辑'); await page.click('高级');
  expect(page.search().tab).toBe('config'); expect(page.text()).toContain('未保存的输入');
  await click('继续编辑'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿');
  await page.click('高级'); await click('放弃输入并离开'); expect(page.search().tab).toBe('advanced');
});

test('放弃载入与清空都明确确认；成功保存后的空值不再被误判为未保存', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'FIRST_DRAFT'); await click('修改'); await click('放弃输入并载入');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '新值'); await click('取消编辑'); expect(page.text()).toContain('放弃开发未保存的输入'); await click('继续编辑');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('新值');
  await click('保存'); await page.click('高级'); expect(page.search().tab).toBe('advanced'); expect(f.writes).toHaveLength(1);
});

test('后台环境草稿也会阻止离开；一次只确认第一个目的地，取消和返回均不写入', async () => {
  const f = fixture(), initial = `/projects/${projectId}/settings?tab=config`;
  const browser = browserHistoryFixture(['/projects', initial]); page = await renderApp(initial, undefined, browser.history); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_HIDDEN'); await page.click('生产');
  await page.click('高级'); await page.click('成员与角色');
  expect(document.querySelectorAll('[role="alertdialog"]')).toHaveLength(1); expect(page.search().tab).toBe('config');
  await click('放弃输入并离开'); expect(page.search().tab).toBe('advanced'); expect(f.writes).toHaveLength(0);
  await page.back(); expect(page.search().tab).toBe('config'); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'PROD_BACK'); await page.back(); expect(page.search().env).toBe('development');
  await page.back(); expect(page.search().tab).toBe('config'); await click('继续编辑'); expect(f.writes).toHaveLength(0);
  expect(browser.beforeUnload()).toBe(false);
  await page.back(); await click('放弃输入并离开'); expect(page.path()).toBe('/projects');
});

test('设置默认只显示开发变量列表；新增、取消和保存的焦点可回到入口', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/settings`);
  expect(page.search()).toEqual({ tab: 'config', env: 'development' });
  expect(visible('input[placeholder="DATABASE_URL"]')).toBeUndefined();
  expect([...document.querySelectorAll('details')].every((node) => !node.open)).toBe(true);
  const add = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => !node.closest('[hidden]') && node.textContent === '新增变量')!;
  await act(async () => { add.focus(); add.click(); }); await page.settle();
  expect(document.activeElement).toBe(visible('input[placeholder="DATABASE_URL"]'));
  await click('取消编辑'); expect(visible('input')).toBeUndefined(); expect(document.activeElement).toBe(add);
  await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'LIST_FIRST'); await click('保存');
  expect(visible('input')).toBeUndefined(); expect(document.activeElement).toBe(add); expect(page.text()).toContain('第 4 版');
});

test('开发保存迟到时只关闭开发编辑器，生产草稿保留且不会自动提交', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_PENDING');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  await click('保存'); await click('生产'); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'PROD_UNSAVED');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), 'production draft');
  await act(async () => { finish(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="DATABASE_URL"]').value).toBe('PROD_UNSAVED');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('production draft');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]!.path).toContain('/development');
  await click('开发'); expect(visible('input')).toBeUndefined(); await page.click('开发资源'); expect(page.search().tab).toBe('config');
});
