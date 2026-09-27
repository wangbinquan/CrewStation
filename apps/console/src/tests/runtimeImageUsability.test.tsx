import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { ImageVersions } from '../features/runtime-images/components/ImageVersions';
import { RecipeSummary } from '../features/runtime-images/components/recipe/RecipeSummary';
import { ValidationEditor } from '../features/runtime-images/components/ValidationEditor';
import { ImageVisibility } from '../features/runtime-images/components/ImageVisibility';
import { RecipeEditor } from '../features/runtime-images/components/recipe/RecipeEditor';
import { inlineRevisionDraft } from '../features/runtime-images/model/inlineDraft';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { renderElement } from './renderElement';
import { renderApp, type RenderedApp } from './renderApp';
import { riImage, riId, runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';
import { MAIN_SCROLL_SELECTOR } from '../app/layout/AppShell';
let page: Awaited<ReturnType<typeof renderElement>> | undefined, app: RenderedApp | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); app?.unmount(); fixture?.restore(); page = undefined; app = undefined; fixture = undefined; });
const dialog = () => [...document.querySelectorAll('dialog[open]')].at(-1)!;
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('开放范围确认固定原修订：并发改动不能悄悄改变确认对象或覆盖新配置', async () => {
  fixture = runtimeImageConsoleFixture(true);
  page = await renderElement(<ImageVisibility image={fixture.image} />, messages);
  await page.click('设为默认开放'); expect(fixture.writes).toHaveLength(0); expect(dialog().textContent).toContain('以后创建的业务');
  fixture.image.revision = 2; fixture.image.defaultVisible = true; await page.click('设为默认开放');
  expect(fixture.writes.at(-1)?.body).toEqual({ defaultVisible: true, expectedRevision: 1 });
  expect(dialog().textContent).toContain('镜像已修改'); await page.click('取消');
});

function Editor() { const [value, setValue] = useState(inlineRevisionDraft); return <><RecipeEditor projectId={undefined} value={value} onChange={setValue} /><output>{value}</output></>; }
test('安装、每次启动与验证分区；添加启动命令用弹窗，非法参数不应用，修改保留其他配置', async () => {
  fixture = runtimeImageConsoleFixture(true); page = await renderElement(<Editor />, messages);
  await page.click('启动与检查（可选）'); await page.click('添加启动步骤');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); await page.click('应用到草稿'); expect(dialog().textContent).toContain('请检查标识');
  await input(dialog().querySelector('input')!, 'prepare-data'); await page.click('取消'); await page.click('添加启动步骤'); expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe('prepare-data'); await input(dialog().querySelector('textarea')!, 'sh\n-c\nmkdir -p /work/data'); await page.click('应用到草稿');
  const draft = () => JSON.parse(page!.host.querySelector('output')!.textContent!);
  expect(draft().initializer.steps[0].argv).toEqual(['sh', '-c', 'mkdir -p /work/data']); expect(draft().source.kind).toBe('inline');
  await page.click('添加工具检查'); await input(dialog().querySelector('input')!, 'python-version'); await input(dialog().querySelector('textarea')!, 'python3\n--version'); await input(dialog().querySelectorAll('textarea')[1]!, 'Python 3.12.0'); await page.click('应用到草稿');
  expect(draft().tools[0].expected).toEqual({ kind: 'text', value: 'Python 3.12.0' }); expect(draft().initializer.steps).toHaveLength(1);
  await page.click('镜像内容'); await page.click('如何预装包、脚本和二进制？'); expect(dialog().textContent).toContain('ARG CS_BASE_IMAGE'); expect(fixture.writes).toHaveLength(0);
});

test('长目录末行进入独立路由，返回恢复搜索、分页与滚动；直达管理页有明确返回入口', async () => {
  fixture = runtimeImageConsoleFixture(true);
  const original = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    if (new URL(String(raw), 'http://test').pathname === '/v1/admin/runtime-image-catalog' && (!init?.method || init.method === 'GET')) return Response.json({ items: Array.from({ length: 30 }, (_, n) => ({ ...fixture!.image, id: n === 29 ? riImage : riId(100 + n), name: `Tools ${n + 1}` })) });
    return original(raw, init);
  }) as typeof fetch;
  app = await renderApp(`/admin/runtime-images?q=Tools&before=${riId(200)}`, undefined, undefined, { scrollRestoration: true });
  const main = () => document.querySelector<HTMLElement>(MAIN_SCROLL_SELECTOR)!;
  main().scrollTop = 1600; main().dispatchEvent(new Event('scroll'));
  const last = [...document.querySelectorAll<HTMLButtonElement>('tbody button')].at(-1)!;
  await act(async () => { last.focus(); last.click(); }); await app.settle();
  expect(app.path()).toBe(`/admin/runtime-images/${riImage}`); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0); expect(main().scrollTop).toBe(0);
  expect(app.text()).toContain('基本信息'); expect(app.text()).not.toContain('设为默认开放');
  await app.click('技术标识'); expect(dialog().textContent).toContain(riImage); await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await app.settle(); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  await app.click('构建配置'); expect(app.text()).toContain('生成镜像版本');
  await app.click('返回镜像列表'); expect(app.search()).toEqual({ q: 'Tools', before: riId(200) }); expect(main().scrollTop).toBe(1600);
  await app.navigate(`/admin/runtime-images/${riImage}`); await app.click('返回镜像列表'); expect(app.path()).toBe('/admin/runtime-images');
});

test('高级 JSON 中不完整的步骤不会让表单崩溃或丢掉草稿；可以继续修正', async () => {
  fixture = runtimeImageConsoleFixture(true); page = await renderElement(<Editor />, messages);
  await page.click('高级 JSON');
  const json = [...page.host.querySelectorAll('textarea')].at(-1)!;
  const invalid = JSON.stringify({ ...JSON.parse(inlineRevisionDraft()), tools: [null], initializer: { steps: [null], env: {}, secrets: [] } });
  await input(json, invalid); expect(json.value).toBe(invalid); await page.click('启动与检查（可选）'); expect(page.text()).toContain('配置尚未填写完整');
  await page.click('高级 JSON'); await input(json, inlineRevisionDraft()); await page.click('启动与检查（可选）'); await page.click('添加工具检查'); expect(dialog().textContent).toContain('预期输出');
});


test('长版本列表末行的技术标识使用弹窗，关闭保留表格、滚动和焦点；Dockerfile 也不在页尾展开', async () => {
  fixture = runtimeImageConsoleFixture(true);
  const original = globalThis.fetch;
  globalThis.fetch = (async (raw, init) => {
    const response = await original(raw, init);
    if (new URL(String(raw), 'http://test').pathname.endsWith('/versions')) {
      const body = await response.json() as { items: Array<Record<string, unknown>> };
      return Response.json({ items: Array.from({ length: 30 }, (_, index) => ({ ...body.items[0], id: riId(300 + index) })) });
    }
    return response;
  }) as typeof fetch;
  page = await renderElement(<ImageVersions projectId={undefined} imageId={riImage} editable manageable owned />, messages);
  const table = page.host.querySelector('table')!; page.host.scrollTop = 1500;
  const last = [...table.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent === '技术标识').at(-1)!;
  await act(async () => { last.focus(); last.click(); }); await page.settle();
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1); expect(dialog().textContent).toContain(riId(329));
  await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(page.host.querySelector('table')).toBe(table); expect(page.host.scrollTop).toBe(1500); expect(document.activeElement).toBe(last);
  page.unmount();
  page = await renderElement(<RecipeSummary revision={{ ...fixture.revision, source: { kind: 'inline', usage: 'task', architecture: 'linux/amd64', dockerfileContent: 'FROM example/tools', files: [], buildArgs: {} } }} />, messages);
  expect(page.text()).not.toContain('FROM example/tools'); await page.click('Dockerfile 内容'); expect(dialog().textContent).toContain('FROM example/tools'); await act(async () => dialog().dispatchEvent(new Event('cancel', { cancelable: true }))); await page.settle(); expect(page.text()).not.toContain('FROM example/tools'); expect(fixture.writes).toHaveLength(0);
});

function ValidationDraft() { const [value, setValue] = useState('{broken'); return <ValidationEditor projectId={riId(10)} value={value} onChange={setValue} />; }
test('验证的高级配置用表单弹窗修正无效 JSON，关闭后草稿保留且未提交验证', async () => {
  fixture = runtimeImageConsoleFixture(true); page = await renderElement(<ValidationDraft />, messages);
  expect(page.text()).toContain('配置尚未填写完整'); await page.click('高级验证配置：完整 JSON 与探针');
  expect(dialog().querySelector('textarea')!.value).toBe('{broken'); await input(dialog().querySelector('textarea')!, '{"usage":"task"}');
  await page.click('取消'); expect(document.querySelectorAll('dialog[open]')).toHaveLength(0);
  await page.click('高级验证配置：完整 JSON 与探针'); expect(dialog().querySelector('textarea')!.value).toBe('{"usage":"task"}'); await page.click('应用到草稿'); expect(fixture.writes).toHaveLength(0);
});
