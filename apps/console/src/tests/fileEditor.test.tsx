import './domSetup';
import { afterEach, expect, test } from 'bun:test';
import { act, StrictMode, useState } from 'react';
import type { FileEditorHandle } from '../features/dev-session/hooks/useFileEditor';
import { useFileEditor } from '../features/dev-session/hooks/useFileEditor';
import type { TaskStreamChannel } from '../features/dev-session/hooks/useTaskStream';
import { renderElement } from './renderElement';
import { StreamCommandError } from '../features/dev-session/model/streamCommandQueue';
import { EditorDiscardPrompt } from '../features/dev-session/components/editor/EditorDiscardPrompt';
import { messages } from '../features/dev-session/i18n/zh-CN';

let page: Awaited<ReturnType<typeof renderElement>> | undefined;
afterEach(() => { page?.unmount(); page = undefined; });

function transport() {
  const calls: Array<{ input: Parameters<TaskStreamChannel['send']>[0]; resolve: (value: unknown) => void; reject: (cause: unknown) => void }> = [];
  const channel: TaskStreamChannel = { send: (input) => new Promise((resolve, reject) => calls.push({ input, resolve, reject })), subscribe: () => () => {} };
  const answer = async (index: number, content: string, version: string) => {
    const call = calls[index]!;
    await act(async () => call.resolve({ path: 'path' in call.input ? call.input.path : '', content, version, size: content.length }));
  };
  return { channel, calls, answer };
}

async function mount(initial: TaskStreamChannel) {
  let editor: FileEditorHandle, switchChannel: (next: TaskStreamChannel) => void;
  function Harness() {
    const [channel, setChannel] = useState(initial); switchChannel = setChannel;
    editor = useFileEditor(channel);
    return <><output>{editor.file?.path} {editor.draft}</output><EditorDiscardPrompt editor={editor} /></>;
  }
  page = await renderElement(<StrictMode><Harness /></StrictMode>, messages);
  return { current: () => editor!, act: async (change: (handle: FileEditorHandle) => void) => { await act(async () => change(editor!)); }, channel: async (next: TaskStreamChannel) => { await act(async () => switchChannel!(next)); } };
}

test('未保存的文件不能因选择其他文件、重新载入或关闭而直接丢失', async () => {
  const f = transport(), editor = await mount(f.channel);
  await editor.act((handle) => handle.openFile('a.ts')); await f.answer(0, '磁盘内容', 'version-a');
  await editor.act((handle) => handle.change('不可丢的草稿'));
  await editor.act((handle) => handle.openFile('b.ts'));
  // 原实现直接读入新文件，旧草稿被后到的 readFile 回执替换。
  expect(f.calls).toHaveLength(1); expect(editor.current().draft).toBe('不可丢的草稿');
  expect(page!.text()).toContain('放弃并打开「b.ts」'); expect(document.activeElement?.textContent).toBe('继续编辑');
  await page!.click('继续编辑'); expect(editor.current().pendingAction).toBeUndefined();
  await editor.act((handle) => handle.reload()); expect(page!.text()).toContain('重新载入磁盘内容');
  await page!.click('继续编辑'); await editor.act((handle) => handle.close());
  expect(page!.text()).toContain('关闭编辑器'); expect(editor.current().file?.path).toBe('a.ts');
  await page!.click('继续编辑'); expect(editor.current().draft).toBe('不可丢的草稿');
  await editor.act((handle) => handle.openFile('b.ts')); await page!.click('放弃输入并继续'); await f.answer(1, '另一个文件', 'version-b');
  expect(editor.current().file?.path).toBe('b.ts'); expect(editor.current().draft).toBe('另一个文件'); expect(editor.current().dirty).toBe(false);
});

test('保存中的快捷键不会重复写入，也不会让随后打开的文件接收旧保存版本', async () => {
  const f = transport(), editor = await mount(f.channel);
  await editor.act((handle) => handle.openFile('a.ts')); await f.answer(0, '原文', 'version-a');
  await editor.act((handle) => handle.change('第一份修改'));
  await editor.act((handle) => { handle.save(); handle.save(); });
  // 工具栏禁用来不及挡住同一轮事件中的重复快捷键，原 hook 会发两次 writeFile。
  expect(f.calls).toHaveLength(2);
  await editor.act((handle) => { handle.openFile('b.ts'); handle.close(); handle.reload(); });
  expect(f.calls).toHaveLength(2); expect(editor.current().file?.path).toBe('a.ts');
  await editor.act((handle) => handle.change('保存发出后继续输入'));
  await f.answer(1, '', 'saved-a');
  expect(editor.current().file?.version).toBe('saved-a'); expect(editor.current().draft).toBe('保存发出后继续输入'); expect(editor.current().dirty).toBe(true);
  await editor.act((handle) => handle.save()); expect(f.calls[2]!.input).toMatchObject({ type: 'writeFile', path: 'a.ts', content: '保存发出后继续输入', expectedVersion: 'saved-a' });
  await f.answer(2, '', 'saved-again'); expect(editor.current().dirty).toBe(false); expect(editor.current().file?.revision).toBe(1);
});

test('确认载入失败保留草稿；版本冲突取消不覆盖，重新载入成功才更换基线', async () => {
  const f = transport(), editor = await mount(f.channel);
  await editor.act((handle) => handle.openFile('a.ts')); await f.answer(0, '旧磁盘', 'before');
  await editor.act((handle) => handle.change('我的修改')); await editor.act((handle) => handle.save());
  expect(f.calls[1]!.input).toMatchObject({ expectedVersion: 'before' });
  await act(async () => f.calls[1]!.reject(new StreamCommandError('version_conflict', 'Agent 已改过磁盘文件')));
  expect(editor.current().conflict).toBe(true); expect(editor.current().draft).toBe('我的修改');
  await editor.act((handle) => handle.dismissConflict()); await editor.act((handle) => handle.save());
  expect(f.calls[2]!.input).toMatchObject({ expectedVersion: 'before' });
  await act(async () => f.calls[2]!.reject(new StreamCommandError('disconnected', '连接已断开')));
  expect(editor.current().error).toBe('连接已断开'); expect(editor.current().dirty).toBe(true);
  await editor.act((handle) => handle.reload()); await page!.click('放弃输入并继续');
  await act(async () => f.calls[3]!.reject(new Error('读取失败')));
  expect(editor.current().draft).toBe('我的修改'); expect(editor.current().file?.version).toBe('before'); expect(editor.current().error).toBe('读取失败');
  await editor.act((handle) => handle.reload()); await page!.click('放弃输入并继续'); await f.answer(4, 'Agent 保存的新内容', 'after');
  expect(editor.current().draft).toBe('Agent 保存的新内容'); expect(editor.current().file?.revision).toBe(2); expect(editor.current().dirty).toBe(false); expect(editor.current().conflict).toBe(false);
});

test('连续读取、读取中编辑、关闭和卸载均隔离迟到回执', async () => {
  const f = transport(), editor = await mount(f.channel);
  await editor.act((handle) => { handle.openFile('first.ts'); handle.openFile('second.ts'); });
  await f.answer(1, '第二个', 'second'); await f.answer(0, '第一个', 'first');
  expect(editor.current().file?.path).toBe('second.ts');
  await editor.act((handle) => handle.openFile('third.ts')); await editor.act((handle) => handle.change('在原文件继续输入'));
  await f.answer(2, '第三个', 'third'); expect(editor.current().draft).toBe('在原文件继续输入'); expect(editor.current().file?.path).toBe('second.ts'); expect(editor.current().busy).toBe(false);
  await editor.act((handle) => handle.close()); await page!.click('放弃输入并继续');
  expect(editor.current().file).toBeUndefined(); expect(editor.current().draft).toBe('');
  await editor.act((handle) => handle.openFile('third.ts')); await editor.act((handle) => handle.close()); await f.answer(3, '迟到', 'late');
  expect(editor.current().file).toBeUndefined(); expect(editor.current().busy).toBe(false);
  await editor.act((handle) => handle.openFile('fourth.ts')); page!.unmount(); page = undefined; await f.answer(4, '卸载后', 'unmounted');
  expect(f.calls).toHaveLength(5);
});

test('缺少版本的读取或指向其他文件的保存回执不能产生虚假保存状态', async () => {
  const f = transport(), editor = await mount(f.channel);
  await editor.act((handle) => handle.openFile('a.ts')); await f.answer(0, '无版本', '');
  expect(editor.current().file).toBeUndefined(); expect(editor.current().error).toContain('未返回有效内容版本');
  await editor.act((handle) => handle.openFile('a.ts')); await f.answer(1, '有效内容', 'valid');
  await editor.act((handle) => handle.change('修改')); await editor.act((handle) => handle.save());
  await act(async () => f.calls[2]!.resolve({ path: 'other.ts', version: 'other' }));
  expect(editor.current().dirty).toBe(true); expect(editor.current().file?.version).toBe('valid'); expect(editor.current().error).toContain('保存结果未确认');
  await editor.act((handle) => handle.save()); expect(f.calls[3]!.input).toMatchObject({ expectedVersion: 'valid' });
  await f.answer(3, '', 'saved'); expect(editor.current().dirty).toBe(false);
});

test('任务通道改变后旧保存回执和旧草稿不能进入新任务', async () => {
  const first = transport(), second = transport(), editor = await mount(first.channel);
  await editor.act((handle) => handle.openFile('same.ts')); await first.answer(0, '旧任务', 'old-version');
  await editor.act((handle) => handle.change('旧修改')); await editor.act((handle) => handle.save());
  await editor.channel(second.channel);
  // 原 hook 的状态跟着组件保留，换 channel 仍把旧任务文件显示出来。
  expect(editor.current().file).toBeUndefined(); expect(editor.current().draft).toBe('');
  await editor.act((handle) => handle.openFile('same.ts')); await second.answer(0, '新任务', 'new-version');
  await first.answer(1, '', 'old-saved-version');
  expect(editor.current().file?.version).toBe('new-version'); expect(editor.current().draft).toBe('新任务'); expect(editor.current().dirty).toBe(false);
});
