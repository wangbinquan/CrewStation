import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { dialogConfirmButton, openDialog, typeConfirmWord } from './confirmDialogDriver';
import { renderApp } from './renderApp';
import { browserHistoryFixture } from './browserHistoryFixture';

const originalFetch = globalThis.fetch, projectId = '01a0bf5d-8f4b-7e1e-8dde-c9c2ae13ed34', serviceId = '01a0bf5d-8f4b-760b-86b6-0bb9f08a9eaa', userId = '01a0bf5d-8f4b-7ed2-8386-a4b2e1a36efb';
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture() {
  const state = { failSave: false, failRead: false, failVersions: false, failIdentity: false, role: 'owner' as 'owner' | 'developer', admin: false, hold: undefined as Promise<void> | undefined };
  const writes: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  // 删掉的项之后不再出现在列表里：成功提示不能依赖删除后重读的列表取名字（2026-09-23 实机：提示里出现 UUID）。
  const deleted = new Set<string>();
  const item = { id: '01a0bf5d-8f4b-741b-855a-427597babed5', definitionId: '01a0bf5d-8f4b-712d-84fa-c34dfa1810f3', bindingName: 'GREETING', name: 'GREETING', value: '当前值', isSecret: false, version: 3, env: 'development', updatedBy: userId, updatedAt: '2026-09-13T01:00:00.000Z' };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    let body: unknown = { items: [] }, status = 200;
    if (method !== 'GET') {
      const input = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined; writes.push({ path, method, body: input });
      if (state.hold) await state.hold;
      if (state.failSave) { status = 503; body = { error: 'unavailable', message: '配置服务暂不可用' }; }
      else if (method === 'DELETE') { deleted.add(path.split('/').at(-1)!); return new Response(null, { status: 204 }); }
      else body = { ...item, ...input, version: 4 };
    } else if (path === '/v1/me') {
      if (state.failIdentity) { status = 503; body = { error: 'unavailable', message: '身份读取失败' }; }
      else body = { id: userId, name: '当前成员', email: 'member@test.invalid', platformRole: (state.admin) ? 'admin' : 'developer', isAdmin: state.admin, memberships: [{ projectId, role: state.role }] };
    }
    else if (path === `/v1/projects/${projectId}`) body = { id: projectId, serviceId, slug: 'demo', name: '演示应用', kind: 'DigitalWorker', ownerUserId: userId, state: 'active' };
    else if (/\/config\/(development|production)$/.test(path)) {
      if (state.failRead) { status = 503; body = { error: 'unavailable', message: '配置读取失败' }; }
      else body = { items: [{ ...item, env: path.endsWith('production') ? 'production' : 'development' }, { ...item, id: '01a0bf5d-8f4b-795e-8427-5e5540ef37fa', definitionId: '01a0bf5d-8f4b-7cd5-8fa7-42c6e13d2afb', bindingName: 'API_TOKEN', name: 'API_TOKEN', isSecret: true, value: undefined }].filter((entry) => !deleted.has(entry.id)) };
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
/** 有弹窗开着时只点得到最上层弹窗里的按钮：模态弹窗后面的页面是惰性的（2026-09-23 起新增与修改都在弹窗里）。 */
async function click(label: string) {
  if (label === '保存') label = `保存到${page!.search().env === 'production' ? '生产' : '开发'}`;
  const scope: ParentNode = [...document.querySelectorAll('dialog[open]')].at(-1) ?? document;
  const button = [...scope.querySelectorAll<HTMLButtonElement>('button')].find((element) => !element.closest('[hidden]') && element.textContent === label)!;
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
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '保留的生产草稿'); f.state.failIdentity = true; await page!.reread();
  expect(page.text()).toContain('身份读取失败');
  // 身份守卫把页面藏起时草稿弹窗也不画（DialogVisibility），输入留在组件里，没有可提交的入口。
  expect(document.querySelectorAll('dialog[open]').length).toBe(0); expect(document.querySelector('input[placeholder="写入后生效于下一次注入"]') === null).toBe(true);
  expect(f.writes).toHaveLength(0);
  f.state.failIdentity = false; await page!.reread();
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('保留的生产草稿'); await click('保存');
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

test('填入普通键保留可读值，密钥不预填；两组失败草稿各自保留，关窗后再点同一项恢复', async () => {
  const f = fixture(); f.state.failSave = true; page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  await click('修改'); expect(openDialog().textContent).toContain('修改 GREETING'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  expect(page.html()).toContain('01a0bf5d-8f4b-741b-855a-427597babed5'); await click('取消');
  const secretRow = () => [...document.querySelectorAll<HTMLTableRowElement>('tr')].find((row) => !row.closest('[hidden]') && row.textContent?.includes('API_TOKEN'))!;
  await act(async () => { secretRow().querySelector('button')!.click(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe(''); expect(page.text()).toContain('旧密钥无法读回');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '开发草稿'); await click('保存');
  expect(openDialog().textContent).toContain('配置服务暂不可用'); await click('取消');
  await page.click('生产'); await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'PRODUCTION_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '生产草稿'); await click('保存');
  expect(f.writes.at(-1)?.path).toBe(`/v1/projects/${projectId}/config/production`); await click('取消');
  await click('开发'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  await act(async () => { secretRow().querySelector('button')!.click(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('开发草稿'); await click('取消');
  await page.click('生产'); await click('新增变量'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('生产草稿');
});

test('删除配置项走弹窗：写清对象与后果，Secret 另有提示，输入 delete 才发出 DELETE', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`);
  const deleteIn = (name: string) => [...document.querySelectorAll<HTMLTableRowElement>('tr')].find((row) => !row.closest('[hidden]') && row.querySelector('td span')?.textContent === name)!
    .querySelectorAll('button')[1]!;
  // 表格行里的动作是紧凑档描边按钮，删除红字红框（2026-09-23 按钮统一）。
  const row = [...document.querySelectorAll<HTMLTableRowElement>('tr')].find((node) => !node.closest('[hidden]') && node.querySelector('td span')?.textContent === 'GREETING')!;
  const [edit, remove] = [...row.querySelectorAll('button')].map((node) => node.className.split(' '));
  expect(edit).toEqual(['button', 'secondary', 'small']); expect(remove).toEqual(['button', 'danger', 'small']);
  await act(async () => { deleteIn('API_TOKEN').click(); }); await page.settle();
  expect(openDialog().textContent).toContain('删除配置项「API_TOKEN」（API_TOKEN）？'); expect(openDialog().textContent).toContain('删除后只能重新写入');
  await typeConfirmWord('delet'); expect(dialogConfirmButton().disabled).toBe(true);
  await click('取消'); expect(document.querySelectorAll('dialog').length).toBe(0); expect(f.writes).toHaveLength(0);
  await act(async () => { deleteIn('GREETING').click(); }); await page.settle();
  expect(openDialog().textContent).toContain('删除配置项「GREETING」（GREETING）？'); expect(openDialog().textContent).not.toContain('删除后只能重新写入');
  expect(openDialog().textContent).toContain('删除后不能恢复');
  await typeConfirmWord('delete'); await click('确认删除');
  expect(document.querySelectorAll('dialog').length).toBe(0);
  expect(f.writes).toEqual([{ path: `/v1/projects/${projectId}/config/development/01a0bf5d-8f4b-741b-855a-427597babed5`, method: 'DELETE', body: undefined }]);
  expect(page.text()).toContain('已删除 开发 的 GREETING。');
});

test('保存进行中防止清空、切编辑项、重复保存与删除；暂时读取失败保留输入且可恢复', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'EDIT_VALUE'); await input(visible('input[placeholder="写入后生效于下一次注入"]'), '草稿');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  await click('保存'); await click('保存中…'); await click('取消');
  // 保存进行中：弹窗的取消与 ✕ 都不可用，页面上的修改、删除与新增也都停用（它们本来就在模态弹窗后面）。
  const pageButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((node) => !node.closest('dialog') && !node.closest('[hidden]') && ['修改', '删除', '新增变量'].includes(node.textContent ?? ''));
  expect(pageButtons.length).toBeGreaterThan(0); expect(pageButtons.every((node) => node.disabled)).toBe(true);
  expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  expect(f.writes).toHaveLength(1); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('草稿');
  await act(async () => { finish(); }); await page.settle(); f.state.hold = undefined; await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'SECOND_VALUE');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '未提交的新内容'); f.state.failRead = true; await page!.reread();
  expect(page.text()).toContain('配置读取失败'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('未提交的新内容');
  await click('保存'); expect(f.writes).toHaveLength(1);
  f.state.failRead = false; f.state.failVersions = true; await page!.reread(); expect(page.text()).toContain('历史服务暂不可用');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').disabled).toBe(false); await click('保存'); expect(f.writes).toHaveLength(2);
});

test('编辑另一配置或离开设置前可保留未保存输入，确认放弃后才跳转', async () => {
  fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DRAFT_KEY');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '不可丢的草稿'); await click('取消'); await click('修改');
  // 旧界面直接换 key 重挂表单，未保存值随组件被销毁。现在先确认；「继续编辑」回到原来那份草稿。
  expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('开发有未保存的输入。放弃后载入「GREETING」？');
  await click('继续编辑'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿');
  await click('取消'); await page.click('高级');
  expect(page.search().tab).toBe('config'); expect(page.text()).toContain('未保存的输入');
  await click('继续编辑'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  await click('新增变量'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('不可丢的草稿'); await click('取消');
  await page.click('高级'); await click('放弃输入并离开'); expect(page.search().tab).toBe('advanced');
});

test('放弃载入要确认；取消只关窗、清空回到载入时的值；成功保存后的空值不再被误判为未保存', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings?tab=config`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'FIRST_DRAFT'); await click('取消'); await click('修改'); await click('放弃输入并载入');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '新值'); await click('取消'); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  await click('修改'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('新值');
  await click('清空'); expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('当前值'); expect(document.querySelectorAll('dialog[open]').length).toBe(1);
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), '新值');
  await click('保存'); await page.click('高级'); expect(page.search().tab).toBe('advanced'); expect(f.writes).toHaveLength(1);
});

test('后台环境草稿也会阻止离开；一次只确认第一个目的地，取消和返回均不写入', async () => {
  const f = fixture(), initial = `/projects/${projectId}/settings?tab=config`;
  const browser = browserHistoryFixture(['/projects', initial]); page = await renderApp(initial, undefined, browser.history); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_HIDDEN'); await click('取消'); await page.click('生产');
  await page.click('高级'); await page.requestNavigate(`/projects/${projectId}/settings?tab=members`);
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
  expect(document.activeElement === visible('input[placeholder="DATABASE_URL"]')).toBe(true);
  await click('取消'); expect(visible('input')).toBeUndefined(); expect(document.activeElement === add).toBe(true);
  await click('新增变量'); await input(visible('input[placeholder="DATABASE_URL"]'), 'LIST_FIRST'); await click('保存');
  expect(visible('input')).toBeUndefined(); expect(document.activeElement === add).toBe(true); expect(page.text()).toContain('第 4 版');
});

test('开发保存迟到时只关闭开发编辑器，生产草稿保留且不会自动提交', async () => {
  const f = fixture(); page = await renderApp(`/projects/${projectId}/settings`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'DEV_PENDING');
  let finish!: () => void; f.state.hold = new Promise<void>((resolve) => { finish = resolve; });
  // 保存进行中弹窗关不掉；用浏览器导航换到生产组：开发组连同它的弹窗藏起，保存照常完成。
  await click('保存'); await page.requestNavigate(`/projects/${projectId}/settings?tab=config&env=production`); await click('新增变量');
  await input(visible('input[placeholder="DATABASE_URL"]'), 'PROD_UNSAVED');
  await input(visible('input[placeholder="写入后生效于下一次注入"]'), 'production draft');
  await act(async () => { finish(); }); await page.settle();
  expect(visible<HTMLInputElement>('input[placeholder="DATABASE_URL"]').value).toBe('PROD_UNSAVED');
  expect(visible<HTMLInputElement>('input[placeholder="写入后生效于下一次注入"]').value).toBe('production draft');
  expect(f.writes).toHaveLength(1); expect(f.writes[0]!.path).toContain('/development');
  await click('取消'); await click('开发'); expect(visible('input')).toBeUndefined(); expect(document.querySelectorAll('dialog[open]').length).toBe(0);
  await page.click('运行与诊断'); expect(page.search().tab).toBe('config');
});
