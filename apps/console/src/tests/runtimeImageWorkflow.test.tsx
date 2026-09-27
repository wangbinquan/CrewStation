import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { RuntimeImagesPage, AdminRuntimeImagesPage } from '../features/runtime-images';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { ProjectScopeProvider } from '../shared/project/ProjectScope';
import { renderElement } from './renderElement';
import { riProject, riImage, riProfile, runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';
let page: Awaited<ReturnType<typeof renderElement>> | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); fixture?.restore(); page = undefined; fixture = undefined; });
async function open() {
  fixture = runtimeImageConsoleFixture(true);
  const router = createRouter({ routeTree: createRootRoute({ component: AdminRuntimeImagesPage }), history: createMemoryHistory({ initialEntries: ['/'] }) });
  await router.load(); page = await renderElement(<RouterProvider router={router} />, messages);
}
const dialog = () => [...document.querySelectorAll('dialog[open]')].at(-1)!;
async function text(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
async function select(node: HTMLSelectElement, value: string) { await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); }

test('平台镜像按算力目录分列展示版本、构建与验证，编辑直接打开配置弹窗', async () => {
  await open(); await page!.settle();
  expect([...page!.host.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(['名称', '最新产物', '最近构建', '验证状态', '操作']);
  const row = page!.host.querySelector('tbody tr')!;
  expect([...row.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['编辑', '更多操作']);
  expect(row.children[1]!.textContent).toContain('linux/amd64');
  expect(row.children[3]!.textContent).toContain('验证通过');
  expect(row.children[1]!.textContent).not.toContain('验证通过');
  await page!.click('编辑');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(dialog().textContent).toContain('修改名称与说明');
  expect(fixture!.writes).toHaveLength(0);
});

test('镜像详情使用统一弹窗，关闭保留原目录和触发按钮焦点', async () => {
  await open(); const table = page!.host.querySelector('table');
  const opener = [...page!.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '更多操作')!;
  await act(async () => { opener.focus(); opener.click(); }); await page!.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(dialog().textContent).toContain('Python tools'); expect(dialog().textContent).toContain('使用记录');
  await act(async () => { dialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page!.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  expect(page!.host.querySelector('table') === table).toBe(true); expect(document.activeElement === opener).toBe(true);
});

test('一次填写名称用途来源并构建，受理失败重试只重发原构建请求，不重复创建镜像', async () => {
  await open(); await page!.click('新增镜像');
  expect(dialog().textContent).toContain('如何预装包、脚本和二进制');
  const inputs = dialog().querySelectorAll<HTMLInputElement>('input'); await text(inputs[0]!, 'Report tools'); await text(inputs[1]!, 'Python reporting');
  await select(dialog().querySelectorAll('select')[1]!, 'existing');
  await text(dialog().querySelectorAll<HTMLInputElement>('input')[2]!, 'runtime/report:v1');
  fixture!.state.buildFailure = true; await page!.click('保存并开始构建');
  expect(page!.text()).toContain('镜像与配方已保存'); expect(fixture!.writes.filter((w) => w.url.endsWith('/setup'))).toHaveLength(1);
  const first = fixture!.writes.find((w) => w.url.endsWith('/builds'))!;
  fixture!.state.buildFailure = false; await page!.click('保存并开始构建');
  expect(fixture!.writes.filter((w) => w.url.endsWith('/setup'))).toHaveLength(1);
  expect(fixture!.writes.at(-1)!.body).toEqual(first.body);
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
  expect(page!.text()).toContain('构建与日志');
});

test('配方错误不发写请求，关窗重开保留名称与来源；目录区别产物和验证', async () => {
  await open(); await page!.settle(); expect(page!.text()).toContain('产物已登记'); expect(page!.text()).toContain('服务容器');
  await page!.click('新增镜像'); await text(dialog().querySelector('input')!, 'My tools');
  await text([...dialog().querySelectorAll('textarea')].at(-1)!, '{invalid'); await page!.click('保存并开始构建'); expect(fixture!.writes).toHaveLength(0);
  await page!.click('取消'); await page!.click('新增镜像'); expect(dialog().querySelector('input')!.value).toBe('My tools'); expect([...dialog().querySelectorAll('textarea')].at(-1)!.value).toBe('{invalid');
});

test('使用记录展示已释放任务与已下线服务，详情链接定位实际执行，配置修改仍走乐观锁', async () => {
  await open(); await page!.click('更多操作'); await page!.click('使用记录');
  expect(page!.text()).toContain('已释放'); expect(page!.text()).toContain('v1.2.0'); expect(page!.text()).toContain('已下线');
  const links = [...page!.host.querySelectorAll<HTMLAnchorElement>('a')];
  expect(links.some((a) => a.getAttribute('href')?.includes('tab=trace&traceId='))).toBe(true);
  expect(links.some((a) => a.getAttribute('href')?.includes('/release?release='))).toBe(true);
  await page!.click('配置与管理'); await page!.click('修改名称与说明'); await text(dialog().querySelector('input')!, 'Renamed'); await page!.click('保存');
  expect(fixture!.writes.at(-1)).toMatchObject({ url: `/v1/admin/runtime-image-catalog/${riImage}`, body: { name: 'Renamed', expectedRevision: 1 } });
  await page!.click('停用此镜像'); expect(fixture!.writes.at(-1)!.body).toMatchObject({ enabled: false, expectedRevision: 2 });
  // A new edit after a successful save and toggle must capture the latest revision.
  await page!.click('修改名称与说明'); await text(dialog().querySelector('input')!, 'Renamed again'); await page!.click('保存');
  expect(fixture!.writes.at(-1)!.body).toMatchObject({ name: 'Renamed again', expectedRevision: 3 });
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});

test('Agent 底座从具名档位选择当前修订，不要求输入内部 ID', async () => {
  await open(); await page!.click('新增镜像');
  await select(dialog().querySelectorAll('select')[2]!, 'agent');
  const profile = [...dialog().querySelectorAll('select')].find((s) => s.textContent?.includes('Agent A'))!;
  await select(profile, riProfile);
  const draft = JSON.parse([...dialog().querySelectorAll('textarea')].at(-1)!.value);
  expect(draft.source.baseProfile).toEqual({ profileId: riProfile, revision: 3 });
  expect(dialog().textContent).not.toContain('算力档位 ID');
});


test('新增回执丢失时锁定已提交配置，重试复用原请求键', async () => {
  await open(); await page!.click('新增镜像'); await text(dialog().querySelector('input')!, 'Uncertain tools');
  await select(dialog().querySelectorAll('select')[1]!, 'existing'); await text(dialog().querySelectorAll<HTMLInputElement>('input')[2]!, 'runtime/tools:1');
  fixture!.state.setupFailure = true; await page!.click('保存并开始构建');
  expect(dialog().textContent).toContain('新增结果尚未确认'); expect(dialog().querySelector('fieldset')!.disabled).toBe(true);
  const first = fixture!.writes[0]!.body; fixture!.state.setupFailure = false; await page!.click('保存并开始构建');
  const retry = fixture!.writes.filter((w) => w.url.endsWith('/setup'))[1]!.body; expect(retry).toEqual(first);
});

test('只读成员能看版本与使用记录，不误发需要开发权限的配方和验证请求', async () => {
  fixture = runtimeImageConsoleFixture(false, 'tester'); page = await renderElement(<ProjectScopeProvider value={{ projectId: riProject, space: 'workbench' }}><RuntimeImagesPage /></ProjectScopeProvider>, messages);
  await page.click('查看'); expect(page.text()).toContain('镜像由平台统一管理');
  expect(fixture.reads.some((url) => /\/(validations|revisions|builds)(\?|$)/.test(url))).toBe(false);
  await page.click('使用记录'); expect(page.text()).toContain('v1.2.0');
});

test('全局新增不要求归属业务；登记已有镜像可直接提交默认开放范围', async () => {
  await open(); await page!.click('新增镜像');
  expect(dialog().textContent).not.toContain('所属项目');
  await text(dialog().querySelector('input')!, 'Global tools');
  await select(dialog().querySelectorAll('select')[0]!, 'true');
  await select(dialog().querySelectorAll('select')[1]!, 'existing');
  expect(dialog().textContent).not.toContain('源码所在业务');
  await text(dialog().querySelectorAll<HTMLInputElement>('input')[2]!, 'runtime/global:v1');
  await page!.click('保存并开始构建');
  expect(fixture!.writes[0]).toMatchObject({ url: '/v1/admin/runtime-image-catalog/setup', body: { defaultVisible: true } });
  expect(fixture!.writes[0]!.body.recipe).not.toHaveProperty('sourceProjectId');
});

test('业务页没有新增或镜像管理入口，即使当前用户是平台管理员', async () => {
  fixture = runtimeImageConsoleFixture(true);
  page = await renderElement(<ProjectScopeProvider value={{ projectId: riProject, space: 'workbench' }}><RuntimeImagesPage /></ProjectScopeProvider>, messages);
  expect(page.text()).not.toContain('新增镜像'); await page.click('查看'); await page.click('配置与管理');
  expect(page.text()).not.toContain('修改名称与说明'); expect(page.text()).not.toContain('停用此镜像');
  expect(fixture.reads.some((url) => /\/(revisions|builds)(\?|$)/.test(url))).toBe(false);
});

test('镜像详情解释业务授权并链接资源页；全局验证明确携带消费业务', async () => {
  await open(); await page!.click('更多操作'); await page!.click('业务授权');
  expect(dialog().textContent).toContain('Tools project'); expect(dialog().textContent).toContain('保留原有授权');
  expect(dialog().querySelector('a')?.getAttribute('href')).toBe(`/admin/projects/${riProject}/resources`);
  await page!.click('镜像版本'); await page!.click('用途验证'); await page!.click('发起验证');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(3);
  expect(dialog().querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
  await select(dialog().querySelector('select')!, riProject); await page!.click('发起验证');
  expect(fixture!.writes.at(-1)).toMatchObject({ url: expect.stringContaining('/v1/admin/runtime-image-catalog/'), body: { projectId: riProject, target: { usage: 'task' } } });
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(2);
  await act(async () => { dialog().dispatchEvent(new Event('cancel', { cancelable: true })); }); await page!.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});
