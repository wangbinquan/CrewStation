import { describe, expect, test } from 'bun:test';
import { WorkspaceLayoutSchema, WorkspaceToolSchema } from '@crewstation/contracts';
import { ApiClientError } from '@crewstation/api-client';
import type { WorkspaceLayoutDto } from '@crewstation/contracts';
import type { SaveWorkspaceLayoutRequest, WorkspaceLayout } from '@crewstation/contracts';
import { initialWorkspaceLayout, layoutTool, withTool } from '../features/dev-session/model/layout/workspaceLayout';
import { normalizeGroups } from '../features/dev-session/model/layout/terminalGroups';
import { locationTool, toolSearch } from '../features/dev-session/model/layout/developmentLocation';
import { WorkspaceLayoutStore } from '../features/dev-session/model/layout/workspaceLayoutStore';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const dto = (layout: WorkspaceLayoutDto['layout'], revision = 1): WorkspaceLayoutDto => ({ layout, revision, updatedAt: '2026-09-13T00:00:00.000Z' });

describe('个人布局与保存竞争', () => {
  test('读入旧布局（工作区页签＋平铺）即迁移成标签组、通过契约校验并只保存一次；之后没有变化的更新不再保存', async () => {
    const [one, two, added] = ['01a0bf5d-8f4b-7c01-8e19-e226732a75a4', '01a0bf5d-8f4b-7c02-8e19-e226732a75a4', '01a0bf5d-8f4b-7c03-8e19-e226732a75a4'];
    const [a, b, c] = ['01a0bf5d-8f4b-7dac-8e19-e226732a75a4', '01a0bf5d-8f4b-7b34-8c40-a2ff43c1a8f6', '01a0bf5d-8f4b-74b4-891b-9e2229ecaa32'];
    const ratios = { columns: [2, 1], rows: [1, 1] };
    const legacy: WorkspaceLayout = { activeTabId: one, tabs: [{ id: one, name: '一', layout: 'columns', paneOrder: [a, b], ratios }, { id: two, name: '二', layout: 'grid', paneOrder: [c], ratios }],
      hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: b, maximizedTerminalId: null };
    const saves: SaveWorkspaceLayoutRequest[] = [];
    const store = new WorkspaceLayoutStore({ get: async () => dto(legacy), save: async (input) => { saves.push(input); return dto(input.layout, input.expectedRevision + 1); } }, initialWorkspaceLayout('默认'), (layout) => normalizeGroups(layout, () => added));
    await store.load();
    const layout = store.getState().layout;
    // 当前工作区里横排的两窗各成一组、按原比例左右排开；另一个工作区的 CLI 成为第一组的后台标签；焦点在原来选中的那窗。
    expect(layout.tabs.map((tab) => [tab.id, tab.paneOrder, tab.activeTerminalId])).toEqual([[one, [a, c], a], [added, [b], b]]);
    expect(layout.dock).toEqual({ direction: 'row', children: [{ group: one }, { group: added }], sizes: [1.3333, 0.6667] });
    expect(layout.activeTabId).toBe(added); expect(WorkspaceLayoutSchema.safeParse(layout).success).toBe(true);
    expect(store.getState().dirty).toBe(true); await store.flush(); expect(saves).toHaveLength(1); expect(saves[0]?.layout).toEqual(layout);
    store.update((value) => ({ ...value })); await store.flush(); expect(saves).toHaveLength(1);
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
