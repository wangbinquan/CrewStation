import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { RuntimeImagesPage, AdminRuntimeImagesPage } from '../features/runtime-images';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { ProjectScopeProvider } from '../shared/project/ProjectScope';
import { renderElement } from './renderElement';
import { riProject, riImage, riVersion, riProfile, riId, runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';

let page: Awaited<ReturnType<typeof renderElement>> | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); page = undefined; fixture?.restore(); fixture = undefined; });
async function open() { fixture = runtimeImageConsoleFixture(); page = await renderElement(<ProjectScopeProvider value={{ projectId: riProject, space: 'workbench' }}><RuntimeImagesPage /></ProjectScopeProvider>, messages); }
const dialog = () => [...document.querySelectorAll('dialog[open]')].at(-1)!;
async function text(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}

test('目录展示真实版本，构建带幂等键，日志按游标续读，取消交给后端确认', async () => {
  await open(); await page!.click('查看'); await page!.click('构建／登记版本');
  const accepted = fixture!.writes.find((write) => write.url.endsWith('/builds'))!;
  expect(accepted.body.revisionId).toBe(fixture!.revision.id); expect(typeof accepted.body.requestKey).toBe('string');
  await page!.click('构建日志'); await page!.reread();
  expect(page!.text()).toContain('install complete'); expect(fixture!.reads.some((url) => url.endsWith('/logs?after=1'))).toBe(true);
  await page!.click('取消构建'); expect(fixture!.writes.at(-1)!.url).toContain('/cancel');
  await page!.click('镜像版本'); await page!.click('用途验证'); expect(page!.text()).toContain('尚未在此验证中启动服务');
});

test('新增修订校验 JSON，关闭保留草稿；配方支持 existing 且不自动构建', async () => {
  await open(); await page!.click('查看'); await page!.click('新增构建修订');
  const recipe = () => dialog().querySelector<HTMLTextAreaElement>('textarea')!;
  await text(recipe(), '{broken'); await page!.click('保存修订');
  expect(fixture!.writes).toHaveLength(0);
  const draft = JSON.stringify({ source: fixture!.revision.source, initializer: { steps: [], env: {}, secrets: [] }, tools: [] });
  await text(recipe(), draft); await page!.click('取消'); await page!.click('新增构建修订'); expect(recipe().value).toBe(draft);
  await page!.click('保存修订'); expect(fixture!.writes).toHaveLength(1); expect(fixture!.writes[0]!.url).toContain('/revisions'); expect(fixture!.writes[0]!.body.source).toEqual(fixture!.revision.source);
});

test('开发配置逐个保存任务与 Agent，版本并发锁保留读取时修订', async () => {
  await open(); await page!.click('配置默认与允许镜像');
  const fields = [...dialog().querySelectorAll('fieldset')]; expect(fields).toHaveLength(2);
  await text(fields[0]!.querySelector<HTMLInputElement>('input')!, riId(19));
  await text(fields[1]!.querySelector<HTMLTextAreaElement>('textarea')!, `${riId(16)}\n${riVersion}\n`);
  expect(fields[1]!.querySelector('textarea')!.value.endsWith('\n')).toBe(true);
  await page!.click('保存'); expect(fixture!.writes[0]!.body).toEqual({ expectedRevision: 7, developmentTask: { runtimeImageVersionId: riId(19) }, developmentAgents: [{ profileId: riProfile, selection: { allowedRuntimeImageVersionIds: [riId(16), riVersion] } }] });
});

test('平台目录仅管理员读取；项目目录不替代管理员跨项目入口', async () => {
  fixture = runtimeImageConsoleFixture(false); page = await renderElement(<AdminRuntimeImagesPage />, messages);
  expect(fixture.reads.some((url) => url.includes('/runtime-image-catalog'))).toBe(false);
  page.unmount(); fixture.restore(); fixture = runtimeImageConsoleFixture(true); page = await renderElement(<AdminRuntimeImagesPage />, messages);
  await page.settle(); expect(fixture.reads.some((url) => url.includes('/runtime-image-catalog'))).toBe(true); expect(page.text()).toContain('Python tools');
  await page.click('查看'); expect(dialog().textContent).toContain('镜像版本');
  expect(document.querySelectorAll('dialog[open]')).toHaveLength(1);
});

test('配置冲突保留草稿，只在明确丢弃后读取最新修订与字段', async () => {
  await open(); await page!.click('配置默认与允许镜像');
  await text(dialog().querySelector<HTMLInputElement>('input')!, riId(19));
  fixture!.state.conflict = true; fixture!.policy.revision = 8;
  await page!.click('保存'); expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe(riId(19));
  await page!.click('丢弃草稿，采用最新配置');
  expect(dialog().querySelector<HTMLInputElement>('input')!.value).toBe(riVersion);
  fixture!.state.conflict = false; await page!.click('保存');
  expect(fixture!.writes.at(-1)!.body.expectedRevision).toBe(8);
});

test('目录删除先停用并检查引用，开发者无管理操作；停用后详情不再允许验证', async () => {
  fixture = runtimeImageConsoleFixture(false, 'developer');
  page = await renderElement(<ProjectScopeProvider value={{ projectId: riProject, space: 'workbench' }}><RuntimeImagesPage /></ProjectScopeProvider>, messages);
  await page.click('查看'); expect(page.text()).not.toContain('停用新选择');
  page.unmount(); fixture.restore(); await open();
  await page!.click('查看'); await page!.click('用途验证');
  await page!.click('停用新选择'); expect(page!.text()).not.toContain('发起验证');
  fixture!.state.references = 1; await page!.reread();
  const remove = () => [...page!.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '删除版本')!;
  expect(remove().disabled).toBe(true);
  fixture!.state.references = 0; await page!.reread();
  await page!.click('删除版本'); await text(dialog().querySelector<HTMLInputElement>('input')!, 'delete');
  const submit = dialog().querySelector<HTMLButtonElement>('button[type=submit]')!;
  await act(async () => submit.click()); await page!.settle();
  expect(fixture!.writes.at(-1)!.url).toContain(`/versions/${riVersion}`);
  expect(page!.text()).toContain('不会立即释放磁盘空间');
});

test('构建来源表单生成已有镜像配方，并保留高级初始化草稿', async () => {
  await open(); await page!.click('查看'); await page!.click('新增构建修订');
  const kind = dialog().querySelector<HTMLSelectElement>('select')!;
  await act(async () => { kind.value = 'existing'; kind.dispatchEvent(new Event('change', { bubbles: true })); });
  await text(dialog().querySelector<HTMLInputElement>('input')!, 'runtime/custom-tools:v2');
  const draft = JSON.parse(dialog().querySelector<HTMLTextAreaElement>('textarea')!.value);
  expect(draft.source).toEqual({ kind: 'existing', reference: 'runtime/custom-tools:v2', usage: 'task', architecture: 'linux/amd64' });
  expect(draft.initializer).toEqual({ steps: [], env: {}, secrets: [] });
  await page!.click('保存修订'); expect(fixture!.writes.at(-1)!.body.source).toEqual(draft.source);
});

test('源码构建从本项目仓库选择绑定，保存的是服务绑定身份而非展示名', async () => {
  await open(); await page!.click('查看'); await page!.click('新增构建修订');
  const kind = dialog().querySelector<HTMLSelectElement>('select')!;
  await act(async () => { kind.value = 'source'; kind.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
  const repository = [...dialog().querySelectorAll<HTMLSelectElement>('select')].find((select) => [...select.options].some((option) => option.textContent === 'Tools project'))!;
  expect(repository).toBeDefined();
  await act(async () => { repository.value = riId(22); repository.dispatchEvent(new Event('change', { bubbles: true })); });
  await page!.click('保存修订');
  expect(fixture!.writes.at(-1)!.body.source).toMatchObject({ kind: 'source', repositoryBindingId: riId(22), ref: 'main' });
});

test('修订超过一页时可选择旧配方，构建不悄悄回到最新修订', async () => {
  await open();
  fixture!.revisions.splice(0, 1, ...Array.from({ length: 21 }, (_, index) => ({ ...fixture!.revision, id: riId(100 + index), revision: 21 - index })));
  await page!.click('查看'); await page!.click('下一页');
  expect(fixture!.reads.some((url) => url.includes(`before=${riId(119)}`))).toBe(true);
  await page!.click('构建／登记版本');
  expect(fixture!.writes.at(-1)!.body.revisionId).toBe(riId(120));
  await page!.click('回到第一页'); await page!.click('构建／登记版本');
  expect(fixture!.writes.at(-1)!.body.revisionId).toBe(riId(100));
});

test('开发配置从具名目录选择默认和允许版本，不修改其他 Agent 的配置', async () => {
  await open(); await page!.click('配置默认与允许镜像');
  await text(dialog().querySelector<HTMLInputElement>('input')!, '');
  const choose = async (label: string) => {
    await page!.click(label);
    const catalog = dialog().querySelector<HTMLSelectElement>('select')!;
    expect(catalog.textContent).toContain('Python tools');
    await act(async () => { catalog.value = riImage; catalog.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
    const version = dialog().querySelectorAll<HTMLSelectElement>('select')[1]!;
    expect(version.textContent).toContain('linux/amd64');
    await act(async () => { version.value = riVersion; version.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
    await page!.click('使用此版本');
  };
  await choose('选择默认镜像'); await choose('添加允许镜像'); await page!.click('保存');
  expect(fixture!.writes.at(-1)!.body).toMatchObject({ developmentTask: { runtimeImageVersionId: riVersion, allowedRuntimeImageVersionIds: [riVersion] }, developmentAgents: fixture!.policy.developmentAgents });
});

test('服务用途验证表单按 argv 保存参数，明确契约检查范围', async () => {
  await open(); await page!.click('查看'); await page!.click('用途验证'); await page!.click('发起验证');
  const usage = dialog().querySelector<HTMLSelectElement>('select')!;
  await act(async () => { usage.value = 'service'; usage.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
  expect(dialog().textContent).toContain('本次检查镜像元数据与服务启动契约');
  expect(dialog().textContent).not.toContain('已检查');
  await text(dialog().querySelector<HTMLTextAreaElement>('textarea')!, '/app/start\nargument with spaces\n--serve');
  const port = dialog().querySelector<HTMLInputElement>('input[type=number]')!;
  await text(port, '8088');
  await text(dialog().querySelector<HTMLInputElement>('input:not([type=number])')!, '/ready');
  await page!.click('发起验证');
  expect(fixture!.writes.at(-1)!.body.target).toEqual({ usage: 'service', command: ['/app/start', 'argument with spaces', '--serve'], port: 8088, healthPath: '/ready' });
});

test('Agent 用途验证按项目档位名称选择，自动固定当前修订', async () => {
  await open(); await page!.click('查看'); await page!.click('用途验证'); await page!.click('发起验证');
  const usage = dialog().querySelector<HTMLSelectElement>('select')!;
  await act(async () => { usage.value = 'agent'; usage.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
  const profile = dialog().querySelectorAll<HTMLSelectElement>('select')[1]!;
  expect(profile.textContent).toContain('Agent A');
  await act(async () => { profile.value = riProfile; profile.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(dialog().querySelector('input[type=number]') === null).toBe(true); await page!.click('发起验证');
  expect(fixture!.writes.at(-1)!.body.target).toEqual({ usage: 'agent', profile: { profileId: riProfile, revision: 3 } });
});
