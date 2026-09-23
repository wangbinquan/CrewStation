import { describe, expect, test } from 'bun:test';
import type { NativeTerminalDto, WorkspaceLayout } from '@crewstation/contracts';
import { WorkspaceLayoutSchema } from '@crewstation/contracts';
import {
  acceptsDrop, activateTerminal, closeTerminal, dropTerminal, equalizeGroups, focusGroup, isTerminalShown, maximizedGroup, migrateLegacyTabs, newGroup, normalizeGroups,
  openTerminal, orderedTerminals, reconcileTerminals, renameTerminal, replaceTerminal, resizeGroups, splitTerminal, toggleMaximize,
} from '../features/dev-session/model/layout/terminalGroups';
import { initialWorkspaceLayout } from '../features/dev-session/model/layout/workspaceLayout';

/** 合法的 UUIDv7：布局契约要求组与 CLI 都是资源 ID，每个结果都拿契约再校验一遍。 */
const id = (n: number) => `01a0bf5d-8f4b-7${(0x100 + n).toString(16).slice(-3)}-8abc-${n.toString(16).padStart(12, '0')}`;
const [G1, G2, G3, G4] = [id(1), id(2), id(3), id(4)];
const [A, B, C, D, E] = [id(11), id(12), id(13), id(14), id(15)];
const valid = (layout: WorkspaceLayout) => { const result = WorkspaceLayoutSchema.safeParse(layout); expect(result.success ? '' : JSON.stringify(result.error.issues)).toBe(''); return layout; };
const base = (tabs: WorkspaceLayout['tabs'], extra: Partial<WorkspaceLayout> = {}): WorkspaceLayout => ({
  activeTabId: tabs[0]!.id, tabs, hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null, ...extra,
});
/** 两组左右排开：左 [A, B]（当前 A），右 [C]。 */
const twoGroups = () => valid(normalizeGroups(base([newGroup(G1, '一', [A, B]), newGroup(G2, '二', [C])], { dock: { direction: 'row', children: [{ group: G1 }, { group: G2 }], sizes: [1, 1] } }), () => G4));
const roster = (entries: [string, NativeTerminalDto['lifecycle']][]) => entries.map(([terminalId, lifecycle]) => ({ terminalId, lifecycle }));

describe('RFC-022 重试原位替换', () => {
  test('新 CLI 占据失败标签在组里的位置并成为当前标签与焦点组，自定义名字随之转过去；旧的记进已关闭列表', () => {
    const layout = valid(renameTerminal(focusGroup(twoGroups(), G2), B, '前端'));
    const next = valid(replaceTerminal(layout, B, D));
    expect(next.tabs.map((tab) => [tab.paneOrder, tab.activeTerminalId])).toEqual([[[A, D], D], [[C], C]]);
    expect(next.activeTabId).toBe(G1); expect(next.selectedTerminalId).toBe(D);
    expect(next.hiddenTerminalIds).toEqual([B]);
    expect(next.terminalNames).toEqual([{ terminalId: D, name: '前端' }]);
    // 放大着的失败标签被替换后，放大的是新的。
    const big = valid(replaceTerminal(valid(toggleMaximize(twoGroups(), A)), A, E));
    expect(big.maximizedTerminalId).toBe(E);
  });

  test('旧标签已不在布局里（被关掉或别处删除）时按普通新开处理；新 CLI 已在布局里时不重复放', () => {
    const closed = valid(closeTerminal(twoGroups(), B));
    expect(valid(replaceTerminal(closed, B, D))).toEqual(valid(openTerminal(closed, D, { activate: true })));
    expect(valid(replaceTerminal(twoGroups(), B, C))).toEqual(valid(openTerminal(twoGroups(), C, { activate: true })));
  });
});

describe('旧布局迁移与规整', () => {
  test('当前工作区平铺的窗各成一组、按原排布摆开：横排左右、纵排上下、网格两列（单出的一格横跨）', () => {
    const legacy = (layout: 'grid' | 'rows' | 'columns', panes: string[]) => base([{ id: G1, name: '一', layout, paneOrder: panes, ratios: { columns: [1, 1], rows: [1, 1] } }]);
    const columns = valid(migrateLegacyTabs(legacy('columns', [A, B]), () => G2));
    expect(columns.dock).toEqual({ direction: 'row', children: [{ group: G1 }, { group: G2 }], sizes: [1, 1] });
    const rows = valid(migrateLegacyTabs(legacy('rows', [A, B]), () => G3));
    expect(rows.dock).toEqual({ direction: 'column', children: [{ group: G1 }, { group: G3 }], sizes: [1, 1] });
    const pool = [G2, G3].values(), grid = valid(migrateLegacyTabs(legacy('grid', [A, B, C]), () => pool.next().value!));
    expect(grid.tabs.map((tab) => tab.paneOrder)).toEqual([[A], [B], [C]]);
    expect(grid.dock).toEqual({ direction: 'column', children: [{ direction: 'row', children: [{ group: G1 }, { group: G2 }], sizes: [1, 1] }, { group: G3 }], sizes: [1, 1] });
  });

  test('只有一窗或放大着时全部进一组，其他工作区的 CLI 作为后台标签跟在后面；已收起的不进来', () => {
    const layout = base([{ id: G1, name: '一', layout: 'grid', paneOrder: [A, B], ratios: { columns: [1, 1], rows: [1, 1] } }, { id: G2, name: '二', layout: 'grid', paneOrder: [C], ratios: { columns: [1, 1], rows: [1, 1] } }],
      { maximizedTerminalId: B, selectedTerminalId: B, hiddenTerminalIds: [D] });
    const migrated = valid(migrateLegacyTabs(layout, () => G3));
    expect(migrated.tabs.map((tab) => [tab.id, tab.paneOrder, tab.activeTerminalId])).toEqual([[G1, [B, A, C], B]]);
    expect(migrated.dock).toEqual({ group: G1 }); expect(migrated.maximizedTerminalId).toBeNull(); expect(migrated.hiddenTerminalIds).toEqual([D]);
  });

  test('规整修正与页签对不上的树、空组、失效的当前标签与名字，且幂等', () => {
    const broken = base([newGroup(G1, '一', [A]), newGroup(G2, '二', []), { ...newGroup(G3, '三', [B]), activeTerminalId: C }],
      { dock: { direction: 'row', children: [{ group: G1 }, { group: G4 }], sizes: [1, 1] }, terminalNames: [{ terminalId: A, name: '前端' }, { terminalId: E, name: '失效' }], hiddenTerminalIds: [D], selectedTerminalId: C, maximizedTerminalId: C });
    const fixed = valid(normalizeGroups(broken, () => G4));
    expect(fixed.tabs.map((tab) => [tab.id, tab.activeTerminalId])).toEqual([[G1, A], [G3, B]]);
    expect(fixed.dock).toEqual({ direction: 'row', children: [{ group: G1 }, { group: G3 }], sizes: [1, 1] });
    expect(fixed.terminalNames).toEqual([{ terminalId: A, name: '前端' }]); expect(fixed.selectedTerminalId).toBeNull(); expect(fixed.maximizedTerminalId).toBeNull();
    expect(normalizeGroups(fixed, () => G4)).toBe(fixed);
    const empty = initialWorkspaceLayout('空'); expect(normalizeGroups(empty, () => G4)).toBe(empty);
  });
});

describe('与名册对账：在运行的 CLI 都有标签', () => {
  test('没位置的在运行 CLI 与已收起的都作为后台标签进焦点组，不抢当前标签；本页刚结束的不放回；已结束的只记进已关闭', () => {
    const layout = { ...twoGroups(), activeTabId: G2, hiddenTerminalIds: [D] };
    const next = valid(reconcileTerminals(layout, roster([[A, 'running'], [D, 'running'], [E, 'starting'], [id(16), 'ended'], [id(17), 'running']]), new Set([id(17)])));
    expect(next.tabs.find((tab) => tab.id === G2)?.paneOrder).toEqual([C, D, E]);
    expect(next.tabs.find((tab) => tab.id === G2)?.activeTerminalId).toBe(C);
    // 本页刚结束的（id 17）名册里还是运行中：不放回标签，只记进已关闭。
    expect(next.hiddenTerminalIds).toEqual([id(16), id(17)]);
    expect(next.tabs.flatMap((tab) => tab.paneOrder)).not.toContain(id(17));
    expect(reconcileTerminals(next, roster([[A, 'running'], [D, 'unknown'], [id(16), 'ended']]), new Set())).toBe(next);
    // 页面刷新后「本页刚结束」的记忆没了：它若仍在运行，就该重新有标签。
    expect(reconcileTerminals(next, roster([[id(17), 'running']]), new Set()).tabs.flatMap((tab) => tab.paneOrder)).toContain(id(17));
  });

  test('空组收到第一个 CLI 时它就是当前标签；自己新开的成为当前标签并取得焦点，别的组放大着先还原', () => {
    const empty = initialWorkspaceLayout('空');
    const first = valid(reconcileTerminals(empty, roster([[A, 'running']]), new Set()));
    expect(first.tabs[0]?.activeTerminalId).toBe(A);
    const big = { ...twoGroups(), maximizedTerminalId: C, activeTabId: G1 };
    const opened = valid(openTerminal(big, E, { activate: true }));
    expect(opened.tabs[0]?.paneOrder).toEqual([A, B, E]); expect(opened.tabs[0]?.activeTerminalId).toBe(E);
    expect(opened.selectedTerminalId).toBe(E); expect(opened.maximizedTerminalId).toBeNull(); expect(isTerminalShown(opened, E)).toBe(true);
  });
});

describe('拖动排列、关闭、放大与改名', () => {
  test('同组拖到另一位置是重排；原地放回、并入自己、组里唯一的标签分到自己旁边都不算放置', () => {
    const layout = twoGroups();
    expect(acceptsDrop(layout, A, { kind: 'tab', group: G1, index: 0 })).toBe(false);
    expect(acceptsDrop(layout, A, { kind: 'tab', group: G1, index: 1 })).toBe(false);
    expect(acceptsDrop(layout, A, { kind: 'center', group: G1 })).toBe(false);
    expect(acceptsDrop(layout, C, { kind: 'split', group: G2, side: 'right' })).toBe(false);
    const reordered = valid(dropTerminal(layout, A, { kind: 'tab', group: G1, index: 2 }, G4));
    expect(reordered.tabs[0]?.paneOrder).toEqual([B, A]); expect(reordered.tabs[0]?.activeTerminalId).toBe(A);
  });

  test('拖到别组标签栏或画面中间是移过去；拖空的组随之消失，树里也去掉', () => {
    const moved = valid(dropTerminal(twoGroups(), A, { kind: 'tab', group: G2, index: 0 }, G4));
    expect(moved.tabs.map((tab) => tab.paneOrder)).toEqual([[B], [A, C]]); expect(moved.activeTabId).toBe(G2); expect(moved.tabs[0]?.activeTerminalId).toBe(B);
    const emptied = valid(dropTerminal(twoGroups(), C, { kind: 'center', group: G1 }, G4));
    expect(emptied.tabs.map((tab) => tab.paneOrder)).toEqual([[A, B, C]]); expect(emptied.dock).toEqual({ group: G1 });
  });

  test('拖到画面一边或菜单「分屏」分出新组；源组只剩它时整组挪过去', () => {
    const split = valid(dropTerminal(twoGroups(), B, { kind: 'split', group: G2, side: 'bottom' }, G4));
    expect(split.dock).toEqual({ direction: 'row', children: [{ group: G1 }, { direction: 'column', children: [{ group: G2 }, { group: G4 }], sizes: [1, 1] }], sizes: [1, 1] });
    expect(split.activeTabId).toBe(G4); expect(split.selectedTerminalId).toBe(B);
    const byMenu = valid(splitTerminal(twoGroups(), A, 'left', G4));
    expect(byMenu.dock).toEqual({ direction: 'row', children: [{ group: G4 }, { group: G1 }, { group: G2 }], sizes: [0.75, 0.75, 1.5] });
    const relocated = valid(dropTerminal(twoGroups(), C, { kind: 'split', group: G1, side: 'top' }, G4));
    expect(relocated.tabs.map((tab) => tab.id)).toEqual([G1, G4]); expect(relocated.dock).toEqual({ direction: 'column', children: [{ group: G4 }, { group: G1 }], sizes: [1, 1] });
    expect(orderedTerminals(relocated)).toEqual([C, A, B]);
  });

  test('关掉标签：同组相邻的接替显示，名字随之删掉；组空了就消失，最后一组留成空组', () => {
    const named = valid(renameTerminal(twoGroups(), A, '  前端  '));
    expect(named.terminalNames).toEqual([{ terminalId: A, name: '前端' }]);
    const closed = valid(closeTerminal(named, A));
    expect(closed.tabs[0]?.paneOrder).toEqual([B]); expect(closed.tabs[0]?.activeTerminalId).toBe(B); expect(closed.hiddenTerminalIds).toEqual([A]); expect(closed.terminalNames).toBeUndefined();
    const lastInGroup = valid(closeTerminal(closed, C));
    expect(lastInGroup.tabs.map((tab) => tab.id)).toEqual([G1]); expect(lastInGroup.dock).toEqual({ group: G1 });
    const nothing = valid(closeTerminal(lastInGroup, B));
    expect(nothing.tabs).toHaveLength(1); expect(nothing.tabs[0]?.paneOrder).toEqual([]); expect(nothing.hiddenTerminalIds).toEqual([A, C, B]);
  });

  test('双击放大所在组、再双击还原；只有一组时不放大；点别组的标签先还原', () => {
    const layout = twoGroups();
    const big = valid(toggleMaximize(layout, B));
    expect(maximizedGroup(big)?.id).toBe(G1); expect(big.tabs[0]?.activeTerminalId).toBe(B); expect(isTerminalShown(big, C)).toBe(false);
    expect(maximizedGroup(toggleMaximize(big, A))).toBeUndefined();
    expect(maximizedGroup(activateTerminal(big, C))).toBeUndefined();
    const single = initialWorkspaceLayout('一'); single.tabs[0]!.paneOrder = [A]; expect(toggleMaximize(single, A)).toBe(single);
  });

  test('改名只接受 1–40 个字符，清空恢复默认；焦点组、分隔条大小与均分各自只改自己的字段', () => {
    const layout = twoGroups();
    expect(renameTerminal(layout, A, 'x'.repeat(41))).toBe(layout);
    expect(renameTerminal(renameTerminal(layout, A, '前端'), A, '   ').terminalNames).toBeUndefined();
    expect(focusGroup(layout, G2).activeTabId).toBe(G2); expect(focusGroup(layout, G2).selectedTerminalId).toBe(C);
    const resized = valid(resizeGroups(layout, [], [3, 1]));
    expect(resized.dock).toEqual({ direction: 'row', children: [{ group: G1 }, { group: G2 }], sizes: [1.5, 0.5] });
    expect(valid(equalizeGroups(resized, [])).dock).toEqual(layout.dock);
  });
});
