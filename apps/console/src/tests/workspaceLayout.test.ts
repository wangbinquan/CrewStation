import { describe, expect, test } from 'bun:test';
import { WorkspaceLayoutSchema } from '@crewstation/contracts';
import { ApiClientError } from '@crewstation/api-client';
import type { WorkspaceLayoutDto } from '@crewstation/contracts';
import { addWorkspaceTab, closeWorkspaceTab, initialWorkspaceLayout, moveTerminal, reconcileWorkspaceLayout, reorderTerminal } from '../features/dev-session/model/layout/workspaceLayout';
import { WorkspaceLayoutStore } from '../features/dev-session/model/layout/workspaceLayoutStore';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const dto = (layout: WorkspaceLayoutDto['layout'], revision = 1): WorkspaceLayoutDto => ({ layout, revision, updatedAt: '2026-09-13T00:00:00.000Z' });

describe('个人布局与保存竞争', () => {
  test('移动、排序、关闭最后页签和恢复均保留真实 CLI 身份', () => {
    let layout = initialWorkspaceLayout('一');
    const one = layout.activeTabId;
    layout = moveTerminal(moveTerminal(layout, 'cli-a', one), 'cli-b', one);
    layout = reorderTerminal(layout, one, 'cli-b', -1);
    expect(layout.tabs[0]?.paneOrder).toEqual(['cli-b', 'cli-a']);
    layout = addWorkspaceTab(layout, '二');
    layout = moveTerminal(layout, 'cli-a', layout.activeTabId);
    layout = closeWorkspaceTab(layout, one, '三');
    expect(layout.hiddenTerminalIds).toEqual(['cli-b']);
    layout = closeWorkspaceTab(layout, layout.activeTabId, '三');
    expect(layout.tabs).toHaveLength(1);
    expect(layout.tabs[0]?.paneOrder).toEqual([]);
    expect(layout.hiddenTerminalIds).toEqual(['cli-b', 'cli-a']);
    layout = moveTerminal(layout, 'cli-b', layout.activeTabId);
    layout = reconcileWorkspaceLayout(layout, ['cli-a', 'cli-b', 'cli-c']);
    expect(layout.tabs[0]?.paneOrder).toEqual(['cli-b']);
    expect(layout.hiddenTerminalIds).toEqual(['cli-a', 'cli-c']);
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
