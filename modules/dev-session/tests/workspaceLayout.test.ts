import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { UserId, WorkspaceLayout } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleWorkspaceLayouts } from '../adapters/persistence/drizzleWorkspaceLayouts';
import { workspaceLayoutUseCases } from '../application/workspaceLayout';
import { devSessionMigrations } from '../wiring';
import { nativeFixture } from './nativeTerminalFixture';
import { workspaceActor, workspaceTask } from './workspaceFixture';

const available = await testDatabaseAvailable();
let database: TestDatabase;
beforeAll(async () => { if (available) database = await createTestDatabase([devSessionMigrations]); });
afterAll(async () => { await database?.drop(); });
const layout = (terminalId: string): WorkspaceLayout => {
  const tabId = Bun.randomUUIDv7();
  return { activeTabId: tabId, tabs: [{ id: tabId, name: '开发', layout: 'grid', paneOrder: [terminalId], ratios: { columns: [1, 2], rows: [1] } }], hiddenTerminalIds: [], selectedTerminalId: terminalId, maximizedTerminalId: null, previewAlongside: false, previewRatio: 0.5, view: 'cli' };
};

describe.skipIf(!available)('个人工作区布局', () => {
  test('真实数据库跨实例 CAS；其他用户独立，过期写入不覆盖并发内容', async () => {
    const f = nativeFixture(), repo = drizzleWorkspaceLayouts(database.db);
    const api = workspaceLayoutUseCases(f.deps, repo, f.repository);
    const terminal = await f.api.startNativeTerminal(workspaceActor, workspaceTask, f.input());
    expect(await api.getWorkspaceLayout(workspaceActor, workspaceTask)).toEqual({ revision: 0, layout: null, updatedAt: null });
    const input = { expectedRevision: 0, layout: layout(terminal.terminalId) };
    const results = await Promise.allSettled([api.saveWorkspaceLayout(workspaceActor, workspaceTask, input), workspaceLayoutUseCases(f.deps, drizzleWorkspaceLayouts(database.db), f.repository).saveWorkspaceLayout(workspaceActor, workspaceTask, input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const other = { ...workspaceActor, userId: '01a0bf5d-8f4b-799e-8662-91273789253a' as UserId };
    expect((await api.getWorkspaceLayout(other, workspaceTask)).revision).toBe(0);
    await api.saveWorkspaceLayout(other, workspaceTask, { ...input, layout: { ...input.layout, view: 'preview' } });
    await api.saveWorkspaceLayout(workspaceActor, workspaceTask, { expectedRevision: 1, layout: { ...input.layout, view: 'code' } });
    await expect(api.saveWorkspaceLayout(workspaceActor, workspaceTask, { ...input, expectedRevision: 1 })).rejects.toMatchObject({ kind: 'conflict' });
    expect((await api.getWorkspaceLayout(workspaceActor, workspaceTask)).layout?.view).toBe('code');
    expect((await api.getWorkspaceLayout(other, workspaceTask)).layout?.view).toBe('preview');
    expect(f.calls.filter((c) => c.type === 'stopAgentTerminal')).toHaveLength(0);
  });
  test('标签组布局（分屏树、每组当前标签、个人起的名字）原样存取；名字指向布局外的 CLI、分屏树里一组出现两次都被拒绝', async () => {
    const f = nativeFixture(), api = workspaceLayoutUseCases(f.deps, drizzleWorkspaceLayouts(database.db), f.repository);
    const one = await f.api.startNativeTerminal(workspaceActor, workspaceTask, f.input()), two = await f.api.startNativeTerminal(workspaceActor, workspaceTask, f.input());
    const [left, right] = [Bun.randomUUIDv7(), Bun.randomUUIDv7()], ratios = { columns: [1, 1], rows: [1, 1] };
    const grouped: WorkspaceLayout = {
      ...layout(one.terminalId), activeTabId: right, selectedTerminalId: two.terminalId,
      tabs: [{ id: left, name: '开发', layout: 'grid', paneOrder: [one.terminalId], ratios, activeTerminalId: one.terminalId }, { id: right, name: '开发', layout: 'grid', paneOrder: [two.terminalId], ratios, activeTerminalId: two.terminalId }],
      dock: { direction: 'row', children: [{ group: left }, { group: right }], sizes: [1.5, 0.5] }, terminalNames: [{ terminalId: two.terminalId, name: '前端' }],
    };
    const user = { ...workspaceActor, userId: Bun.randomUUIDv7() as UserId };
    expect((await api.saveWorkspaceLayout(user, workspaceTask, { expectedRevision: 0, layout: grouped })).layout).toEqual(grouped);
    expect((await api.getWorkspaceLayout(user, workspaceTask)).layout).toEqual(grouped);
    await expect(api.saveWorkspaceLayout(user, workspaceTask, { expectedRevision: 1, layout: { ...grouped, terminalNames: [{ terminalId: 'outside-terminal', name: '外面' }] } })).rejects.toMatchObject({ kind: 'validation' });
    await expect(api.saveWorkspaceLayout(user, workspaceTask, { expectedRevision: 1, layout: { ...grouped, dock: { direction: 'row', children: [{ group: left }, { group: left }], sizes: [1, 1] } } })).rejects.toMatchObject({ kind: 'validation' });
    expect(f.calls.filter((c) => c.type === 'stopAgentTerminal')).toHaveLength(0);
  });
  test('拒绝跨会话终端、重复位置、未知字段；授权失效时读写都不可继续', async () => {
    const f = nativeFixture();
    const api = workspaceLayoutUseCases(f.deps, drizzleWorkspaceLayouts(database.db), f.repository);
    const value = layout('other-task-terminal');
    await expect(api.saveWorkspaceLayout(workspaceActor, workspaceTask, { expectedRevision: 1, layout: value })).rejects.toMatchObject({ kind: 'validation' });
    await expect(api.saveWorkspaceLayout(workspaceActor, workspaceTask, { expectedRevision: 1, layout: { ...value, hiddenTerminalIds: ['other-task-terminal'] } })).rejects.toMatchObject({ kind: 'validation' });
    f.deps.authorizer.authorize = async () => { throw forbidden(); };
    await expect(api.getWorkspaceLayout(workspaceActor, workspaceTask)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(api.saveWorkspaceLayout(workspaceActor, workspaceTask, { expectedRevision: 1, layout: value })).rejects.toMatchObject({ kind: 'forbidden' });
  });
});
