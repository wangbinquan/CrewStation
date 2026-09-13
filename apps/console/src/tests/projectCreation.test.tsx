import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { browserHistoryFixture } from './browserHistoryFixture';

const originalFetch = globalThis.fetch;
const userId = `usr_${'a'.repeat(32)}`, projectId = `prj_${'b'.repeat(32)}`;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

function fixture(admin = true) {
  const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
  const state = { catalogFailure: false, createFailure: false, projectFailure: false, retryFailure: false, status: 'provisioning', kind: 'APIProxy',
    holdCreate: undefined as Promise<void> | undefined, noTemplates: false, resultOverride: undefined as Record<string, unknown> | undefined };
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ path, method, body });
    let result: unknown = { items: [] }, status = 200;
    if (path === '/v1/me') result = { id: userId, name: '管理者', email: 'admin@test.invalid', isAdmin: admin, memberships: [] };
    else if (path === '/v1/users') result = { items: [{ id: userId, name: '负责人甲', email: 'owner@test.invalid' }] };
    else if (path === '/v1/catalog/project-templates') {
      if (state.catalogFailure) { status = 503; result = { error: 'unavailable', message: '模板目录离线' }; }
      else result = { items: state.noTemplates ? [] : [
        { name: 'minimal-sample', kind: 'DigitalWorker', servicePlan: 'standard-small', requiredConfig: [] },
        { name: 'reference-api-proxy', kind: 'APIProxy', servicePlan: 'standard-small', requiredConfig: [{ name: 'GITLAB_TOKEN', from: 'secret' }] },
        { name: 'gitlab-event-producer', kind: 'EventProducer', servicePlan: 'standard-small', requiredConfig: [] },
      ] };
    } else if (path === '/v1/catalog/service-plans') result = { items: [{ name: 'standard-small', cpu: '500m', memory: '512Mi', maxReplicas: 3, description: '小套餐' }, { name: 'standard-large', cpu: '2', memory: '4Gi', maxReplicas: 4, description: '大套餐' }] };
    else if (path === '/v1/projects' && method === 'POST') {
      if (state.holdCreate) await state.holdCreate;
      if (state.createFailure) { status = 409; result = { error: 'conflict', message: '项目标识已占用', details: { field: 'slug' } }; }
      else { state.kind = String(body!.kind); result = { ...body, id: projectId, namespace: 'cs-billing', createdAt: '2026-09-13T00:00:00.000Z', state: state.status, ...state.resultOverride }; }
    } else if (path === `/v1/projects/${projectId}`) {
      if (state.projectFailure) { status = 503; result = { error: 'unavailable', message: '状态暂时无法读取' }; }
      else result = { id: projectId, kind: state.kind, name: '账单接入', slug: 'billing', state: state.status, message: state.status === 'failed' ? 'ensureFirstRelease 失败：缺少 GITLAB_TOKEN' : undefined };
    } else if (path.endsWith('/provision')) {
      if (state.retryFailure) { status = 503; result = { error: 'unavailable', message: '排队失败' }; }
      else { status = 202; result = { queued: true }; }
    } else if (path.endsWith('/dev-session')) { status = 404; result = { error: 'not_found', message: '没有会话' }; }
    return new Response(JSON.stringify(result), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { state, requests, writes: () => requests.filter((r) => r.method !== 'GET') };
}

async function field(name: string, value: string) {
  const node = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;
  expect(node).toBeDefined();
  await act(async () => {
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    node.focus(); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}

test('新建入口归管理空间，工作台不再内嵌平台创建表单', async () => {
  const f = fixture(); page = await renderApp('/projects');
  // 原版把所有 kind 和原始模板输入放在工作台日常列表上方。
  expect(document.querySelectorAll('[name="name"], [name="slug"], [name="template"], [name="kind"]').length).toBe(0);
  expect(document.querySelectorAll('form').length).toBe(1);
  expect(f.writes()).toHaveLength(0);
  await page.click('新建数字人'); expect(page.path()).toBe('/admin/projects/new');
  expect(page.text()).toContain('基本信息'); expect(document.querySelector('[name="kind"]')).toBeNull();
});

test('逐步校验所有字段，返回保留草稿；按真实 kind 过滤模板并提交套餐与配额', async () => {
  const f = fixture(); page = await renderApp('/admin/capabilities?tab=integrations');
  await page.click('新建接入容器'); expect(page.search().scope).toBe('integration');
  expect(document.querySelector('select[name="kind"] option[value="DigitalWorker"]')).toBeNull();
  expect(page.text()).toContain('1–80 字'); expect(page.text()).toContain('3–40 位');
  await page.click('下一步'); expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3); expect(f.writes()).toHaveLength(0);
  await field('name', '  账单接入  '); await field('slug', 'billing'); await field('ownerUserId', userId);
  await page.click('下一步'); expect(page.text()).toContain('1–100');
  expect(document.querySelector('[name="template"] option[value="minimal-sample"]')).toBeNull();
  await page.click('下一步'); expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
  await field('template', 'reference-api-proxy'); await field('plan', 'standard-large'); await field('maxConcurrentTasks', '101');
  await page.click('下一步'); expect(document.querySelector('[name="maxConcurrentTasks"]')!.getAttribute('aria-invalid')).toBe('true');
  await field('maxConcurrentTasks', '7'); await page.click('下一步');
  expect(page.text()).toContain('GITLAB_TOKEN'); expect(page.text()).toContain('不会自动提供这些值');
  await page.click('上一步'); expect(document.querySelector<HTMLInputElement>('[name="maxConcurrentTasks"]')!.value).toBe('7');
  await page.click('上一步'); expect(document.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('  账单接入  ');
  await page.click('下一步'); await page.click('下一步'); await page.click('创建项目');
  expect(f.writes()).toHaveLength(1); expect(f.writes()[0]?.body).toEqual({ name: '账单接入', slug: 'billing', ownerUserId: userId, kind: 'APIProxy', template: 'reference-api-proxy', plan: 'standard-large', maxConcurrentTasks: 7 });
  expect(page.path()).toBe(`/admin/projects/${projectId}/provisioning`); expect(page.text()).toContain('不提供逐阶段进度');
  await page.click('进入开发'); expect(page.path()).toBe(`/admin/integrations/${projectId}/dev-session`);
});

async function readyToCreate() {
  await field('name', '新数字人'); await field('slug', 'billing'); await field('ownerUserId', userId);
  await page!.click('下一步'); await field('template', 'minimal-sample'); await field('plan', 'standard-small'); await page!.click('下一步');
}

test('服务器字段错误返回原步骤并保留全部选择，空任务配额保留默认语义', async () => {
  const f = fixture(); f.state.createFailure = true; page = await renderApp('/admin/projects/new'); await readyToCreate(); await page.click('创建项目');
  expect(page.text()).toContain('项目标识已占用'); expect(document.querySelector('[name="slug"]')!.getAttribute('aria-invalid')).toBe('true');
  expect(document.querySelector<HTMLInputElement>('[name="name"]')!.value).toBe('新数字人');
  f.state.createFailure = false; await field('slug', 'new-billing'); await page.click('下一步');
  expect(document.querySelector<HTMLSelectElement>('[name="template"]')!.value).toBe('minimal-sample');
  await page.click('下一步'); await page.click('创建项目');
  expect(f.writes().at(-1)!.body).not.toHaveProperty('maxConcurrentTasks');
  expect(page.path()).toBe(`/admin/projects/${projectId}/provisioning`);
  await page.click('进入开发'); expect(page.path()).toBe(`/projects/${projectId}/dev-session`);
});

test('目录暂时失败保留输入但不能创建；恢复后选择仍在，切类型不能沿用旧模板', async () => {
  const f = fixture(); page = await renderApp('/admin/projects/new?scope=integration');
  await field('name', '接入'); await field('slug', 'billing'); await field('ownerUserId', userId); await page.click('下一步');
  await field('template', 'reference-api-proxy'); await field('plan', 'standard-large');
  f.state.catalogFailure = true; await page.click('重新读取目录'); expect(page.text()).toContain('模板目录离线');
  await page.click('下一步'); expect(f.writes()).toHaveLength(0); expect(document.querySelector<HTMLSelectElement>('[name="template"]')!.value).toBe('reference-api-proxy');
  f.state.catalogFailure = false; await page.click('重新读取目录'); await page.click('上一步'); await field('kind', 'EventProducer'); await page.click('下一步');
  expect(document.querySelector<HTMLSelectElement>('[name="template"]')!.value).toBe('');
  expect(document.querySelector('[name="template"] option[value="reference-api-proxy"]')).toBeNull();
  expect(document.querySelector('[name="template"] option[value="gitlab-event-producer"]')).not.toBeNull();
});

test('开通失败可补生产配置与排队重试；202 和 active 都不冒充已经部署上线', async () => {
  const f = fixture(); f.state.status = 'failed'; page = await renderApp(`/admin/projects/${projectId}/provisioning`);
  expect(page.text()).toContain('缺少 GITLAB_TOKEN'); f.state.retryFailure = true; await page.click('重新开通'); expect(page.text()).toContain('排队失败');
  f.state.retryFailure = false; await page.click('重新开通'); expect(page.text()).toContain('排队成功不代表开通已完成'); expect(page.text()).toContain('开通失败');
  await page.click('补充生产配置'); expect(page.path()).toBe(`/admin/integrations/${projectId}/settings`); expect(page.search()).toMatchObject({ tab: 'config', env: 'production' });
  await page.navigate(`/admin/projects/${projectId}/provisioning`); f.state.projectFailure = true; await page.click('刷新开通状态');
  expect(page.text()).toContain('状态暂时无法读取'); expect(document.querySelectorAll('button')).not.toHaveLength(0);
  expect([...document.querySelectorAll('button')].some((button) => button.textContent === '重新开通')).toBe(false);
  f.state.projectFailure = false; f.state.status = 'active'; await page.click('刷新开通状态');
  expect(page.text()).toContain('首个版本的构建与部署结果'); await page.click('查看发布与上线'); expect(page.path()).toBe(`/admin/integrations/${projectId}/release`);
});

test('非管理员无法打开创建或开通管理页面，不请求用户和模板目录', async () => {
  const f = fixture(false); page = await renderApp('/admin/projects/new?scope=integration');
  expect(document.querySelector('form')).toBeNull(); expect(f.requests.some((r) => r.path === '/v1/catalog/project-templates' || r.path === '/v1/users')).toBe(false);
  await page.navigate(`/admin/projects/${projectId}/provisioning`); expect(f.requests.some((r) => r.path === `/v1/projects/${projectId}`)).toBe(false);
});

test('创建在途不能重复提交或回退修改；目录为空显示明确原因，非法项目链接不查询', async () => {
  const f = fixture(); page = await renderApp('/admin/projects/new'); await readyToCreate();
  let finish!: () => void; f.state.holdCreate = new Promise<void>((resolve) => { finish = resolve; });
  await page.click('创建项目'); await page.click('创建中'); await page.click('上一步');
  expect(f.writes()).toHaveLength(1); expect(document.querySelector('[name="template"]')).toBeNull();
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe(`/admin/projects/${projectId}/provisioning`);
  f.state.noTemplates = true; await page.navigate('/admin/projects/new');
  await field('name', '新数字人'); await field('slug', 'new-worker'); await field('ownerUserId', userId); await page.click('下一步');
  expect(page.text()).toContain('当前类型暂无可用模板');
  const before = f.requests.length; await page.requestNavigate('/admin/projects/invalid/provisioning'); await page.click('放弃输入并离开');
  expect(page.text()).toContain('项目标识无效'); expect(f.requests.slice(before).some((r) => r.path === '/v1/projects/invalid')).toBe(false);
});

test('创建草稿：返回管理入口和切换创建类型先确认，取消保留，确认后才清空且不会串输入', async () => {
  const f = fixture(); page = await renderApp('/admin/projects/new'); await field('name', '尚未完成的数字人');
  // 旧向导离开直接卸载；再次进入时名称和模板选择全部消失。
  await page.click('返回管理总览'); expect(page.path()).toBe('/admin/projects/new'); await page.click('继续编辑');
  expect(document.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('尚未完成的数字人');
  await page.requestNavigate('/admin/projects/new?scope=integration'); expect(page.search().scope).not.toBe('integration');
  await page.click('放弃输入并离开'); expect(page.search().scope).toBe('integration'); expect(document.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('');
  expect(document.querySelector<HTMLSelectElement>('[name="kind"]')?.value).toBe('APIProxy'); expect(f.writes()).toHaveLength(0);
});

test('创建草稿：目录和创建失败不清除离开保护，空白向导可直接返回', async () => {
  const f = fixture(); page = await renderApp('/admin/projects/new');
  await page.click('返回管理总览'); expect(page.path()).toBe('/admin'); await page.navigate('/admin/projects/new'); await readyToCreate();
  f.state.catalogFailure = true; await page.click('重新读取目录'); await page.click('返回管理总览');
  expect(page.path()).toBe('/admin/projects/new'); await page.click('继续编辑');
  f.state.catalogFailure = false; await page.click('重新读取目录'); f.state.createFailure = true; await page.click('创建项目');
  await page.click('返回管理总览'); expect(page.path()).toBe('/admin/projects/new'); await page.click('继续编辑');
  expect(document.querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('新数字人'); expect(f.writes()).toHaveLength(1);
  f.state.createFailure = false; await field('slug', 'retry-worker'); await page.click('下一步'); await page.click('下一步'); await page.click('创建项目');
  expect(page.path()).toBe(`/admin/projects/${projectId}/provisioning`); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});

test('创建草稿：在途离开需确认，重复 submit 只写一次，迟到创建成功不抢回当前页面', async () => {
  const f = fixture(); let finish!: () => void; f.state.holdCreate = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp('/admin/projects/new'); await readyToCreate(); const form = document.querySelector('form')!;
  await act(async () => { for (let i = 0; i < 2; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await page.settle();
  expect(f.writes()).toHaveLength(1); expect(page.text()).toContain('离开不会撤销创建或开通');
  await page.requestNavigate('/admin/service-plans'); expect(page.path()).toBe('/admin/projects/new'); await page.click('继续编辑'); expect(page.text()).toContain('新数字人');
  await page.requestNavigate('/admin/service-plans'); await page.click('放弃输入并离开'); expect(page.path()).toBe('/admin/service-plans');
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe('/admin/service-plans'); expect(f.writes()).toHaveLength(1);
});

test('创建草稿：不匹配或无效创建回执保留复核材料，不导航到错误项目也不自动重试', async () => {
  const f = fixture(); f.state.resultOverride = { kind: 'APIProxy' }; page = await renderApp('/admin/projects/new'); await readyToCreate(); await page.click('创建项目');
  expect(page.path()).toBe('/admin/projects/new'); expect(page.text()).toContain('创建结果无法与本次输入对应'); expect(page.text()).toContain('新数字人'); expect(f.writes()).toHaveLength(1);
  await page.click('上一步'); expect(document.querySelector<HTMLSelectElement>('[name="template"]')?.value).toBe('minimal-sample'); await page.click('下一步');
  f.state.resultOverride = { id: 'invalid-project' }; await page.click('创建项目'); expect(page.path()).toBe('/admin/projects/new'); expect(f.writes()).toHaveLength(2);
  await page.click('返回管理总览'); expect(document.querySelector('[role="alertdialog"]')).not.toBeNull(); await page.click('继续编辑');
});

test('创建草稿：浏览器返回保留资源选择，取消不写入，成功接续后返回历史不再次提交', async () => {
  const f = fixture(), browser = browserHistoryFixture(['/admin', '/admin/projects/new']);
  page = await renderApp('/admin/projects/new', undefined, browser.history); await readyToCreate();
  await page.back(); expect(page.path()).toBe('/admin/projects/new'); await page.click('继续编辑');
  expect(browser.beforeUnload()).toBe(false); expect(page.text()).toContain('minimal-sample'); expect(f.writes()).toHaveLength(0);
  await page.click('创建项目'); expect(page.path()).toBe(`/admin/projects/${projectId}/provisioning`);
  await page.back(); expect(page.path()).toBe('/admin'); expect(f.writes()).toHaveLength(1);
});
