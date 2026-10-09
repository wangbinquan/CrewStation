import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { renderApp } from './renderApp';
import { openDialog } from './confirmDialogDriver';
import { creationFixtureProject, creationPlanId, creationProjectId, creationUserId, projectCreationFixture } from './projectCreationFixture';

const originalFetch = globalThis.fetch;
let page: Awaited<ReturnType<typeof renderApp>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; globalThis.fetch = originalFetch; });

async function field(name: string, value: string) {
  const node = openDialog().querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
  if (!node) throw new Error(`缺少字段 ${name}`);
  await act(async () => {
    const proto = node instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    node.focus(); Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event(node instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
  }); await page!.settle();
}
async function cancelWithEscape() {
  await act(async () => { openDialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page!.settle();
}
async function resources() {
  await act(async () => { openDialog().querySelector('summary')!.click(); }); await page!.settle();
}
async function ready() { await field('name', '新数字人'); await field('slug', 'billing'); }
const inputValue = (name: string) => openDialog().querySelector<HTMLInputElement>(`[name="${name}"]`)?.value;

test('开发列表打开共享弹窗，无独立创建页；关闭、重开、Esc、清空保留列表与焦点', async () => {
  const f = projectCreationFixture('developer'); f.state.rows = Array.from({ length: 40 }, (_, n) => creationFixtureProject(n + 1));
  page = await renderApp('/projects?q=数字&cursor=page-2'); const path = page.path(), search = page.search();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  await page.click('新建项目'); expect(page.path()).toBe(path); expect(openDialog().getAttribute('data-cs-dialog')).toBe('');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(document.activeElement === openDialog().querySelector('[name="name"]')).toBe(true);
  // 两个示例的名字和选中后的说明都必须明确界面差异，避免把纯 API 示例当成可打开的页面。
  const templateSection = openDialog().querySelector('[name="template"]')!.closest('section')!;
  expect(templateSection.querySelector('option[value="01a0bf5d-8f4b-7002-9560-94caf593fb19"]')?.textContent).toBe('基础应用（有界面）');
  expect(templateSection.querySelector('option[value="01a0e222-de8b-7000-8cd8-207c8673b62e"]')?.textContent).toBe('业务执行示例（仅接口，无界面）');
  expect(templateSection.querySelector('strong + p')?.textContent).toContain('可在浏览器中打开的应用界面');
  await ready(); await field('template', '01a0e222-de8b-7000-8cd8-207c8673b62e');
  expect(templateSection.querySelector('strong')?.textContent).toBe('业务执行示例（仅接口，无界面）');
  expect(templateSection.querySelector('strong + p')?.textContent).toContain('仅提供 API 接口，没有应用界面');
  expect(openDialog().textContent).toContain('后台业务任务'); expect(openDialog().textContent).toContain('billing.installed.apps.test');
  await page.click('取消'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(page.search()).toEqual(search);
  expect(document.activeElement?.textContent).toContain('新建项目');
  await page.click('新建项目'); expect(inputValue('name')).toBe('新数字人'); expect(inputValue('template')).toBe('01a0e222-de8b-7000-8cd8-207c8673b62e');
  await cancelWithEscape(); expect(page.path()).toBe(path); expect(page.search()).toEqual(search); expect(f.writes()).toHaveLength(0);
  await page.click('新建项目'); await page.click('清空'); expect(inputValue('name')).toBe(''); expect(inputValue('slug')).toBe('');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(document.activeElement?.getAttribute('name')).toBe('name');
});

test('旧自建和管理员书签落到列表弹窗，关闭不再停留新建路由', async () => {
  projectCreationFixture('developer'); page = await renderApp('/projects/new'); expect(page.path()).toBe('/projects'); expect(openDialog().textContent).toContain('域名标识');
  await page.click('取消'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  page.unmount(); projectCreationFixture(); page = await renderApp('/admin/projects/new'); expect(page.path()).toBe('/admin/projects'); expect(openDialog().textContent).toContain('负责人');
  expect(openDialog().querySelector('[name="template"] option[value="01a0e222-de8b-7000-8cd8-207c8673b62e"]')?.textContent).toBe('业务执行示例（仅接口，无界面）');
  await field('template', '01a0e222-de8b-7000-8cd8-207c8673b62e');
  expect(openDialog().querySelector('[name="template"]')?.closest('section')?.querySelector('strong + p')?.textContent).toContain('仅提供 API 接口，没有应用界面');
  await cancelWithEscape(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
});

test('管理员在接入列表同一弹窗选择真实类型、模板、套餐与额度，配置必填项和用途同时可见', async () => {
  const f = projectCreationFixture(); page = await renderApp('/admin/capabilities?tab=integrations&q=账单');
  const search = page.search(); await page.click('新建接入容器'); expect(page.path()).toBe('/admin/capabilities'); expect(page.search()).toEqual(search);
  expect(openDialog().querySelector('select[name="kind"] option[value="DigitalWorker"]')).toBeNull();
  expect(openDialog().textContent).toContain('GITLAB_TOKEN'); expect(openDialog().textContent).toContain('不会自动提供这些值');
  expect(openDialog().textContent).toContain('转发到 GitLab'); expect(openDialog().querySelector('[name="template"] option[value="01a0bf5d-8f4b-7002-9560-94caf593fb19"]')).toBeNull();
  await field('name', '  账单接入  '); await field('slug', 'billing'); expect(openDialog().textContent).toContain('billing.services.test');
  await resources(); await field('plan', '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4'); await field('maxConcurrentTasks', '101'); await page.click('创建项目');
  expect(openDialog().querySelector('[name="maxConcurrentTasks"]')?.getAttribute('aria-invalid')).toBe('true'); expect(f.writes()).toHaveLength(0);
  await field('maxConcurrentTasks', '7'); await page.click('创建项目');
  expect(f.writes()).toHaveLength(1); expect(f.writes()[0]?.body).toEqual({ name: '账单接入', slug: 'billing', ownerUserId: creationUserId, kind: 'APIProxy', template: '01a0bf5d-8f4b-7003-9dbe-4adc78f388e9', plan: '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4', maxConcurrentTasks: 7 });
  expect(page.path()).toBe('/admin/capabilities'); expect(openDialog().textContent).toContain('不提供逐阶段进度');
  await cancelWithEscape(); expect(page.search()).toEqual(search);
});

test('自建负责人只读、默认资源不作为覆盖提交；成功在原列表显示真实开通结果', async () => {
  const f = projectCreationFixture('developer'); page = await renderApp('/projects'); await page.click('新建项目');
  expect(openDialog().querySelectorAll('[name="ownerUserId"], [name="plan"], [name="maxConcurrentTasks"]')).toHaveLength(0);
  expect(openDialog().textContent).toContain('管理者'); expect(openDialog().textContent).toContain('最多 3 个并发任务');
  await ready(); await page.click('创建项目');
  expect(f.writes()).toHaveLength(1); expect(f.writes()[0]?.body).toEqual({ name: '新数字人', slug: 'billing', kind: 'DigitalWorker', template: '01a0bf5d-8f4b-7002-9560-94caf593fb19' });
  expect(page.path()).toBe('/projects'); expect(openDialog().textContent).toContain('开通'); expect(f.requests.some((r) => r.path === '/v1/users' || r.path === '/v1/catalog/project-templates' || r.path === '/v1/catalog/service-plans')).toBe(false);
});

test('本地必填与服务端字段错误聚焦原字段，不清除已填写内容或默认资源语义', async () => {
  const f = projectCreationFixture(); f.state.createFailure = true; page = await renderApp('/admin/projects/new');
  await page.click('创建项目'); expect(openDialog().querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
  expect(document.activeElement?.getAttribute('name')).toBe('name'); expect(f.writes()).toHaveLength(0);
  await ready(); await page.click('创建项目'); expect(openDialog().textContent).toContain('项目标识已占用'); expect(document.activeElement?.getAttribute('name')).toBe('slug');
  expect(inputValue('name')).toBe('新数字人'); f.state.createFailure = false; await field('slug', 'new-billing'); await page.click('创建项目');
  expect(f.writes().at(-1)?.body).not.toHaveProperty('maxConcurrentTasks'); expect(page.path()).toBe('/admin/projects');
});

test('迟到域名响应不能盖新输入；非法或空标识清除旧域名，失败不猜安装后缀', async () => {
  const f = projectCreationFixture('developer'); let release!: () => void; f.state.domainHolds.set('old-name', new Promise<void>((resolve) => { release = resolve; }));
  page = await renderApp('/projects/new'); await field('slug', 'old-name'); expect(openDialog().textContent).toContain('正在读取域名');
  await field('slug', 'new-name'); expect(openDialog().textContent).toContain('new-name.installed.apps.test');
  await act(async () => { release(); }); await page.settle(); expect(openDialog().textContent).not.toContain('old-name.installed.apps.test');
  await field('slug', 'BAD ID'); expect(openDialog().querySelectorAll('code')).toHaveLength(0); await field('slug', ''); expect(openDialog().textContent).toContain('输入域名标识');
  expect(f.requests.filter((r) => r.path.endsWith('project-domain-preview')).map((r) => r.url.searchParams.get('slug'))).toEqual(['old-name', 'new-name']);
  f.state.domainFailure = true; await field('slug', 'another-name'); expect(openDialog().textContent).toContain('域名暂时无法读取'); expect(openDialog().querySelectorAll('code')).toHaveLength(0);
});

test('模板目录失败保留选择且阻止提交；类型切换使用该类型目录，重读不覆盖已选套餐', async () => {
  const f = projectCreationFixture(); page = await renderApp('/admin/projects/new?scope=integration'); await ready(); await resources();
  await field('plan', '01a0bf5d-8f4b-76b5-8a28-f084e91fddf4'); f.state.catalogFailure = true; await page.reread();
  expect(openDialog().textContent).toContain('模板目录离线'); await page.click('创建项目'); expect(f.writes()).toHaveLength(0);
  expect(inputValue('plan')).toBe('01a0bf5d-8f4b-76b5-8a28-f084e91fddf4'); f.state.catalogFailure = false; await page.reread();
  await field('kind', 'EventProducer'); expect(inputValue('template')).toBe('01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbc'); expect(openDialog().textContent).toContain('接收 GitLab Webhook');
  await field('template', '01a0bf5d-8f4b-7004-9cf7-0eb8bf66ffbd'); expect(openDialog().textContent).toContain('接收 GitHub Webhook'); expect(inputValue('plan')).toBe('01a0bf5d-8f4b-76b5-8a28-f084e91fddf4');
});

test('不匹配的域名回执显示读取失败，不把别的项目地址作为当前预览', async () => {
  const f = projectCreationFixture('developer'); f.state.domainMismatch = true; page = await renderApp('/projects/new'); await field('slug', 'billing');
  expect(openDialog().textContent).toContain('域名暂时无法读取'); expect(openDialog().querySelectorAll('code')).toHaveLength(0);
});

test('创建在途锁定字段、关闭与重复提交；完成只受理一次并留下原列表', async () => {
  const f = projectCreationFixture(); let finish!: () => void; f.state.holdCreate = new Promise<void>((resolve) => { finish = resolve; });
  page = await renderApp('/admin/projects/new'); await ready(); await page.click('创建项目'); await page.click('创建中'); await cancelWithEscape();
  expect(f.writes()).toHaveLength(1); expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(openDialog().querySelector<HTMLInputElement>('[name="name"]')?.disabled).toBe(true);
  await act(async () => { finish(); }); await page.settle(); expect(page.path()).toBe('/admin/projects'); expect(openDialog().textContent).toContain('开通');
});

test('未知创建回执不得重发；核对完整匹配项目后才显示开通，关闭不丢核对状态', async () => {
  const f = projectCreationFixture(); f.state.resultOverride = { id: 'invalid' }; page = await renderApp('/admin/projects/new'); await ready(); await page.click('创建项目');
  expect(openDialog().textContent).toContain('创建结果无法'); await page.click('创建项目'); expect(f.writes()).toHaveLength(1);
  await page.click('取消'); await page.click('新建数字人'); expect(openDialog().textContent).toContain('创建结果无法'); await page.click('核对创建结果');
  expect(openDialog().textContent).toContain('开通'); expect(f.writes()).toHaveLength(1);
});

test('空模板目录明确提示；非管理员管理入口不请求代建目录', async () => {
  const f = projectCreationFixture(); f.state.noTemplates = true; page = await renderApp('/admin/projects/new'); await ready(); await page.click('创建项目');
  expect(openDialog().textContent).toContain('当前类型暂无可用模板'); expect(f.writes()).toHaveLength(0);
  page.unmount(); const denied = projectCreationFixture('developer'); page = await renderApp('/admin/projects/new?scope=integration');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(denied.requests.some((r) => r.path === '/v1/users' || r.path === '/v1/catalog/project-templates')).toBe(false);
});

test('离开有输入的列表仍需确认，继续编辑保留草稿，确认离开不串入下次创建', async () => {
  const f = projectCreationFixture(); page = await renderApp('/admin/projects/new'); await field('name', '尚未完成的数字人'); await page.click('取消');
  await page.requestNavigate('/admin/capabilities?tab=integrations'); expect(openDialog().getAttribute('role')).toBe('alertdialog');
  await page.click('继续编辑'); expect(page.path()).toBe('/admin/projects'); await page.click('新建数字人'); expect(inputValue('name')).toBe('尚未完成的数字人'); await page.click('取消');
  await page.requestNavigate('/admin/capabilities?tab=integrations'); await page.click('放弃输入并离开'); expect(page.path()).toBe('/admin/capabilities'); await page.click('新建接入容器');
  expect(inputValue('name')).toBe(''); expect(f.writes()).toHaveLength(0);
});

test('原状态详情继续区分开通、发布与上线；失败后可以配置并重试', async () => {
  const f = projectCreationFixture(); f.state.status = 'failed'; page = await renderApp(`/admin/projects/${creationProjectId}/provisioning`);
  expect(page.text()).toContain('缺少 GITLAB_TOKEN'); f.state.retryFailure = true; await page.click('重新开通'); expect(page.text()).toContain('排队失败');
  f.state.retryFailure = false; await page.click('重新开通'); expect(page.text()).toContain('排队成功不代表开通已完成');
  await page.click('补充生产配置'); expect(page.path()).toBe(`/admin/integrations/${creationProjectId}/settings`);
  await page.navigate(`/admin/projects/${creationProjectId}/provisioning`); f.state.projectFailure = true; await page.reread(); expect(page.text()).toContain('状态暂时无法读取');
  f.state.projectFailure = false; f.state.status = 'active'; await page.reread(); expect(page.text()).toContain('首个版本的构建与部署结果');
});

test('非法项目详情书签不发项目请求，管理员资源空值继续使用平台默认', async () => {
  const f = projectCreationFixture(); page = await renderApp('/admin/projects/invalid/provisioning'); expect(page.text()).toContain('项目标识无效');
  expect(f.requests.some((r) => r.path === '/v1/projects/invalid')).toBe(false);
  await page.navigate('/admin/projects/new'); await ready(); expect(inputValue('plan')).toBe(creationPlanId); await page.click('创建项目'); expect(f.writes()[0]?.body).not.toHaveProperty('maxConcurrentTasks');
});
