import { describe, expect, test } from 'bun:test';
import { WorkspaceLayoutSchema, WorkspaceToolSchema } from '@crewstation/contracts';
import { ApiClientError } from '@crewstation/api-client';
import type { WorkspaceLayoutDto } from '@crewstation/contracts';
import { addWorkspaceTab, closeWorkspaceTab, initialWorkspaceLayout, layoutTool, moveTerminal, reconcileWorkspaceLayout, reorderTerminal, withTool } from '../features/dev-session/model/layout/workspaceLayout';
import { locationTool, toolSearch } from '../features/dev-session/model/layout/developmentLocation';
import { WorkspaceLayoutStore } from '../features/dev-session/model/layout/workspaceLayoutStore';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const dto = (layout: WorkspaceLayoutDto['layout'], revision = 1): WorkspaceLayoutDto => ({ layout, revision, updatedAt: '2026-09-13T00:00:00.000Z' });

describe('个人布局与保存竞争', () => {
  test('移动、排序、关闭最后页签和恢复均保留真实 CLI 身份', () => {
    let layout = initialWorkspaceLayout('一');
    const one = layout.activeTabId;
    layout = moveTerminal(moveTerminal(layout, '01a0bf5d-8f4b-7dac-8e19-e226732a75a4', one), '01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', one);
    layout = reorderTerminal(layout, one, '01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', -1);
    expect(layout.tabs[0]?.paneOrder).toEqual(['01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', '01a0bf5d-8f4b-7dac-8e19-e226732a75a4']);
    layout = addWorkspaceTab(layout, '二');
    layout = moveTerminal(layout, '01a0bf5d-8f4b-7dac-8e19-e226732a75a4', layout.activeTabId);
    layout = closeWorkspaceTab(layout, one, '三');
    expect(layout.hiddenTerminalIds).toEqual(['01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6']);
    layout = closeWorkspaceTab(layout, layout.activeTabId, '三');
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0]?.paneOrder).toEqual([]);
    expect(layout.hiddenTerminalIds).toEqual(['01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', '01a0bf5d-8f4b-7dac-8e19-e226732a75a4']);
    layout = moveTerminal(layout, '01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', layout.activeTabId);
    layout = reconcileWorkspaceLayout(layout, ['01a0bf5d-8f4b-7dac-8e19-e226732a75a4', '01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', '01a0bf5d-8f4b-74b4-891b-9e2229ecaa32']);
    expect(layout.tabs[0]?.paneOrder).toEqual(['01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6']);
    expect(layout.hiddenTerminalIds).toEqual(['01a0bf5d-8f4b-7dac-8e19-e226732a75a4', '01a0bf5d-8f4b-74b4-891b-9e2229ecaa32']);
    expect(WorkspaceLayoutSchema.safeParse(layout).success).toBe(true);
  });
  test('写请求串行；旧回执和晚到刷新不能覆盖后续编辑', async () => {
    const initial = initialWorkspaceLayout('原始');
    const first = deferred<WorkspaceLayoutDto>(), delayedRead = deferred<WorkspaceLayoutDto>();
    const writes: { expectedRevision: number; layout: typeof initial }[] = [];
    let reads = 0;
    const store = new WorkspaceLayoutStore({ get: () => ++reads === 1 ? Promise.resolve(dto(initial)) : delayedRead.promise, save: async (input) => { writes.push(input); return writes.length === 1 ? first.promise : dto(input.layout, input.expectedRevision + 1); } }, initial);
    await store.load();
    const reading = store.load();
    store.update((value) => ({ ...value, view: 'preview' }));
    const saving = store.flush();
    store.update((value) => ({ ...value, view: 'code' }));
    delayedRead.resolve(dto(initial)); await reading;
    first.resolve(dto(writes[0]!.layout, 2)); await saving;
    expect(store.getState().layout.view).toBe('code');
    await store.flush();
    expect(writes.map((input) => [input.expectedRevision, input.layout.view])).toEqual([[1, 'preview'], [2, 'code']]);
  });
  test('保存回执丢失保留草稿；重新应用先对账，不重复写入已保存内容', async () => {
    const initial = initialWorkspaceLayout('原始');
    let remote = dto(initial), writes = 0;
    const store = new WorkspaceLayoutStore({ get: async () => remote, save: async (input) => { writes++; remote = dto(input.layout, 2); throw new Error('response lost'); } }, initial);
    await store.load();
    store.update((value) => ({ ...value, view: 'preview' })); await store.flush();
    expect(store.getState()).toMatchObject({ phase: 'error', layout: { view: 'preview' } });
    await store.load();
    expect(store.getState().phase).toBe('error');
    await store.reapply();
    expect(writes).toBe(1);
    expect(store.getState()).toMatchObject({ phase: 'ready', revision: 2, layout: { view: 'preview' } });
  });
  test('另一窗口先保存时不自动覆盖；选择重新应用才使用最新 revision', async () => {
    const initial = initialWorkspaceLayout('原始');
    let remote = dto(initial), writes = 0;
    const store = new WorkspaceLayoutStore({ get: async () => remote, save: async (input) => {
      writes++;
      if (input.expectedRevision !== remote.revision) throw new ApiClientError(409, { error: 'conflict', message: '另一个窗口已保存', details: {} });
      remote = dto(input.layout, remote.revision + 1); return remote;
    } }, initial);
    await store.load();
    remote = dto({ ...initial, view: 'code' }, 2);
    store.update((value) => ({ ...value, view: 'preview' })); await store.flush();
    expect(store.getState()).toMatchObject({ phase: 'conflict', layout: { view: 'preview' } });
    await store.load(); await store.flush();
    expect(writes).toBe(1); expect(remote.layout?.view).toBe('code');
    await store.reapply();
    expect(remote).toMatchObject({ revision: 3, layout: { view: 'preview' } });
  });
});

describe('工具面板状态（RFC-020 D1）', () => {
  test('旧布局按 view／previewAlongside 推导工具；写入回填旧字段并夹住比例', () => {
    const base = initialWorkspaceLayout('一');
    expect(layoutTool(base)).toBeUndefined();
    expect(layoutTool({ ...base, view: 'code' })).toEqual({ name: 'code', mode: 'full', ratio: 0.45 });
    expect(layoutTool({ ...base, previewAlongside: true, previewRatio: 0.7 })).toEqual({ name: 'preview', mode: 'side', ratio: 0.6 });
    const next = withTool(base, { name: 'data', mode: 'side', ratio: 0.5 });
    expect(next.tool).toEqual({ name: 'data', mode: 'side', ratio: 0.5 }); expect(next.view).toBe('cli'); expect(next.previewAlongside).toBe(false);
    // 旧读者只认 view 与 previewAlongside：放大的代码回填 view=code，预览在旁回填 previewAlongside 与比例。
    expect(withTool(base, { name: 'code', mode: 'full', ratio: 0.5 }).view).toBe('code');
    const preview = withTool(base, { name: 'preview', mode: 'side', ratio: 0.35 }); expect(preview.previewAlongside).toBe(true); expect(preview.previewRatio).toBe(0.35);
    expect(withTool(next, { name: 'data', mode: 'side', ratio: 0.5 })).toBe(next);
    const closed = withTool(next, undefined); expect(closed.tool).toBeUndefined(); expect(closed.view).toBe('cli'); expect(closed.previewAlongside).toBe(false);
    expect(WorkspaceLayoutSchema.safeParse(next).success).toBe(true);
    expect(WorkspaceLayoutSchema.safeParse({ ...next, tool: { name: 'terminal', mode: 'side', ratio: 0.5 } }).success).toBe(false);
    expect(WorkspaceToolSchema.safeParse({ name: 'code', mode: 'side', ratio: 0.2 }).success).toBe(false);
    expect(WorkspaceToolSchema.safeParse({ name: 'code', mode: 'side', ratio: 0.5, extra: true }).success).toBe(false);
  });
  test('地址与面板互译：view=cli 收起，split 是预览在旁，diff／target 是变更，panel=full 放大', () => {
    expect(locationTool({})).toBeUndefined(); expect(locationTool({ view: 'conversation' })).toBeUndefined(); expect(locationTool({ view: 'cli' })).toBeNull();
    expect(locationTool({ view: 'split' })).toEqual({ name: 'preview', mode: 'side' });
    expect(locationTool({ view: 'changes' })).toEqual({ name: 'changes', mode: 'side' }); expect(locationTool({ target: 'preview' })).toEqual({ name: 'changes', mode: 'side' });
    expect(locationTool({ view: 'reference', panel: 'full' })).toEqual({ name: 'reference', mode: 'full' }); expect(locationTool({ file: 'a.ts' })).toEqual({ name: 'code', mode: 'side' });
    expect(toolSearch(null, { view: 'code', panel: 'full', file: 'a.ts' })).toEqual({ view: 'cli', file: 'a.ts' });
    expect(toolSearch({ name: 'data', mode: 'full' }, { topic: 'api' })).toEqual({ view: 'data', panel: 'full', topic: 'api' });
    expect(toolSearch({ name: 'preview', mode: 'side' }, { view: 'cli', panel: 'full' })).toEqual({ view: 'preview' });
  });
});
