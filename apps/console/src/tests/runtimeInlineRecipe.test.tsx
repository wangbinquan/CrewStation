import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { CreateImageDialog } from '../features/runtime-images/components/CreateImageDialog';
import { messages } from '../features/runtime-images/i18n/zh-CN';
import { renderElement } from './renderElement';
import { runtimeImageConsoleFixture } from './runtimeImageConsoleFixture';

let page: Awaited<ReturnType<typeof renderElement>> | undefined, fixture: ReturnType<typeof runtimeImageConsoleFixture> | undefined;
afterEach(() => { page?.unmount(); fixture?.restore(); page = undefined; fixture = undefined; });
const dialog = () => document.querySelector('dialog[open]')!;
async function open() { fixture = runtimeImageConsoleFixture(true); page = await renderElement(<CreateImageDialog projectId={undefined} open onClose={() => {}} onCreated={() => {}} />, messages); }
async function input(node: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => { node.focus(); Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true })); }); await page!.settle();
}
async function files(values: File[]) {
  const node = dialog().querySelector<HTMLInputElement>('input[type=file]')!;
  await act(async () => { Object.defineProperty(node, 'files', { configurable: true, value: values }); node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
}
async function kind(value: string) { const node = dialog().querySelectorAll('select')[1]!; await act(async () => { node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle(); }
const draft = () => JSON.parse([...dialog().querySelectorAll('textarea')].at(-1)!.value);

test('新增默认直接编写，不请求业务仓库；上传二进制、编辑路径、允许执行并提交固定配方', async () => {
  await open(); expect(dialog().querySelectorAll('select')[1]!.value).toBe('inline');
  expect(fixture!.reads.some((url) => url.includes('/projects'))).toBe(false);
  await input(dialog().querySelector('input')!, 'Standalone tools');
  await input(dialog().querySelector('textarea')!, 'ARG CS_BASE_IMAGE\nFROM ${CS_BASE_IMAGE}\nCOPY bin/check /usr/local/bin/check');
  await files([new File([new Uint8Array([0, 255, 128])], 'check')]);
  const path = [...dialog().querySelectorAll<HTMLInputElement>('input')].find((node) => node.value === 'check')!;
  await input(path, 'bin/check');
  const executable = [...dialog().querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0]!;
  await act(async () => executable.click()); await page!.settle();
  expect(draft().source.files).toEqual([{ path: 'bin/check', contentBase64: 'AP+A', executable: true }]);
  await page!.click('创建并生成版本');
  expect(fixture!.writes[0]!.body.recipe).not.toHaveProperty('sourceProjectId');
  expect(fixture!.writes[0]!.body.recipe).toMatchObject({ source: { kind: 'inline', files: [{ path: 'bin/check', contentBase64: 'AP+A', executable: true }] } });
  expect(fixture!.writes[1]!.url).toContain('/builds');
});

test('上传期间不能提交，晚到文件保留最新 Dockerfile；切换来源保留草稿且能移除文件', async () => {
  await open(); await input(dialog().querySelector('input')!, 'Draft');
  let finish!: (value: ArrayBuffer) => void;
  const file = new File(['slow'], 'slow.txt'); Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }) });
  await files([file]); expect(page!.button('创建并生成版本').disabled).toBe(true);
  await input(dialog().querySelector('textarea')!, 'FROM scratch\n# updated during upload');
  await act(async () => finish(new TextEncoder().encode('slow').buffer)); await page!.settle();
  expect(draft().source.dockerfileContent).toContain('updated during upload'); expect(draft().source.files).toHaveLength(1);
  expect(page!.button('创建并生成版本').disabled).toBe(false);
  await kind('existing'); await kind('inline'); expect(draft().source.dockerfileContent).toContain('updated during upload');
  await page!.click('移除文件'); expect(draft().source.files).toEqual([]);
  expect(fixture!.writes).toHaveLength(0);
});

test('超限、重复、读失败和无效高级文件可见报错，不破坏已有草稿或发请求', async () => {
  await open();
  await files([new File([new Uint8Array(512 * 1024 + 1)], 'large.bin')]); expect(page!.text()).toContain('总计 512 KiB'); expect(draft().source.files).toEqual([]);
  await files([new File(['a'], 'duplicate'), new File(['b'], 'duplicate')]); expect(page!.text()).toContain('重复'); expect(draft().source.files).toEqual([]);
  const broken = new File(['x'], 'broken'); Object.defineProperty(broken, 'arrayBuffer', { value: async () => { throw new Error('read failed'); } });
  await files([broken]); expect(page!.text()).toContain('文件读取失败');
  const invalid = { ...draft(), source: { ...draft().source, files: [null] } };
  await input([...dialog().querySelectorAll('textarea')].at(-1)!, JSON.stringify(invalid));
  expect(page!.text()).toContain('构建文件格式无效'); expect(fixture!.writes).toHaveLength(0);
});

test('切换来源后到达的上传结果不能覆盖当前草稿', async () => {
  await open(); let finish!: (value: ArrayBuffer) => void;
  const file = new File(['late'], 'late.txt'); Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>((resolve) => { finish = resolve; }) });
  await files([file]); await kind('existing');
  await act(async () => finish(new TextEncoder().encode('late').buffer)); await page!.settle();
  expect(draft().source.kind).toBe('existing'); expect(fixture!.writes).toHaveLength(0);
});


test('服务用途使用无平台 Runner 的起始模板，自定义 Dockerfile 不被用途切换覆盖', async () => {
  await open();
  const purpose = () => dialog().querySelectorAll('select')[2]!;
  await act(async () => { purpose().value = 'service'; purpose().dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
  expect(draft().source.dockerfileContent).toStartWith('FROM alpine');
  await input(dialog().querySelector('textarea')!, 'FROM custom/base');
  await act(async () => { purpose().value = 'task'; purpose().dispatchEvent(new Event('change', { bubbles: true })); }); await page!.settle();
  expect(draft().source.dockerfileContent).toBe('FROM custom/base');
});

test('从仓库切到直接编写再返回时，来源业务与仓库草稿一起保留', async () => {
  await open(); await kind('source');
  const value = { ...draft(), sourceProjectId: '01a0e231-5614-7000-be6b-82ee33fb22ba' };
  await input([...dialog().querySelectorAll('textarea')].at(-1)!, JSON.stringify(value));
  await kind('inline'); expect(draft()).not.toHaveProperty('sourceProjectId');
  await kind('source'); expect(draft().sourceProjectId).toBe(value.sourceProjectId);
});
