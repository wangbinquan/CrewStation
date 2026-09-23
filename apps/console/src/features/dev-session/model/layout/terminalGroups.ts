import { newDraftResourceId } from '@crewstation/api-client';
import type { NativeTerminalDto, WorkspaceLayout, WorkspaceTab } from '@crewstation/contracts';
import type { DockDrop } from '../../../../shared/ui/dock/dockDrop';
import type { DockNode, DockPath, DockSide } from '../../../../shared/ui/dock/dockTree';
import { alignGroups, dockGroups, equalizeSizes, removeGroup, setSizes, splitGroup, tidy } from '../../../../shared/ui/dock/dockTree';

/**
 * CLI 标签组（2026-09-23 裁定：Xshell 式）。布局里每个 `tabs[]` 项是一组标签，`dock` 是组的分屏树；
 * 每个在运行的 CLI 都有一个标签，× 就是结束进程，没有「收起」这回事——`hiddenTerminalIds` 只记已经关掉的、已结束的 CLI。
 * 所有函数都不改入参；没有变化时原样返回同一个对象（布局存储据此跳过保存）。
 */
export const GROUP_LIMIT = 16, TABS_PER_GROUP = 32, LAYOUT_TERMINALS = 256;
const LIVE: ReadonlySet<NativeTerminalDto['lifecycle']> = new Set(['starting', 'running', 'unknown']);

export function isLiveTerminal(terminal: Pick<NativeTerminalDto, 'lifecycle'> | undefined): boolean {
  return !terminal || LIVE.has(terminal.lifecycle);
}

export function newGroup(id: string, name: string, paneOrder: readonly string[] = []): WorkspaceTab {
  return { id, name, layout: 'grid', paneOrder: [...paneOrder], ratios: { columns: [1, 1], rows: [1, 1] }, ...(paneOrder[0] ? { activeTerminalId: paneOrder[0] } : {}) };
}

export function groupOf(layout: WorkspaceLayout, terminalId: string): WorkspaceTab | undefined {
  return layout.tabs.find((tab) => tab.paneOrder.includes(terminalId));
}

/** 放大的那一组：含 `maximizedTerminalId` 的组。 */
export function maximizedGroup(layout: WorkspaceLayout): WorkspaceTab | undefined {
  return layout.maximizedTerminalId ? groupOf(layout, layout.maximizedTerminalId) : undefined;
}

export function layoutDock(layout: WorkspaceLayout): DockNode {
  return layout.dock ?? alignGroups(undefined, layout.tabs.map((tab) => tab.id)) ?? { group: layout.tabs[0]!.id };
}

/** 这个 CLI 此刻在不在屏幕上：是所在组的当前标签，且没有别的组被放大。 */
export function isTerminalShown(layout: WorkspaceLayout, terminalId: string): boolean {
  const group = groupOf(layout, terminalId), big = maximizedGroup(layout);
  return !!group && group.activeTerminalId === terminalId && (!big || big.id === group.id);
}

export function customName(layout: WorkspaceLayout, terminalId: string): string | undefined {
  return layout.terminalNames?.find((entry) => entry.terminalId === terminalId)?.name;
}

function settle(layout: WorkspaceLayout, next: WorkspaceLayout): WorkspaceLayout {
  return JSON.stringify(next) === JSON.stringify(layout) ? layout : next;
}

/**
 * 读入与每次改动后的规整（幂等）：没有分屏树的旧布局先推出一棵；空组去掉（至少留一组）；树与组一一对应；
 * 每组的当前标签、焦点组、选中与放大都指向布局里真实存在的 CLI；名字只留给布局里有位置的 CLI。
 */
export function normalizeGroups(layout: WorkspaceLayout, newId: () => string): WorkspaceLayout {
  const migrated = layout.dock ? layout : migrateLegacyTabs(layout, newId);
  const filled = migrated.tabs.filter((tab) => tab.paneOrder.length > 0);
  const keep = filled.length ? filled : [migrated.tabs.find((tab) => tab.id === migrated.activeTabId) ?? migrated.tabs[0]!];
  const tabs = keep.map((tab) => {
    const active = tab.activeTerminalId && tab.paneOrder.includes(tab.activeTerminalId) ? tab.activeTerminalId : tab.paneOrder[0];
    const { activeTerminalId: _old, ...rest } = tab;
    return active ? { ...rest, activeTerminalId: active } : rest;
  });
  const panes = tabs.flatMap((tab) => tab.paneOrder), known = new Set([...panes, ...migrated.hiddenTerminalIds]);
  const selected = migrated.selectedTerminalId && panes.includes(migrated.selectedTerminalId) ? migrated.selectedTerminalId : null;
  const focused = tabs.find((tab) => tab.id === migrated.activeTabId) ?? tabs.find((tab) => selected && tab.paneOrder.includes(selected)) ?? tabs[0]!;
  const names = (migrated.terminalNames ?? []).filter((entry, index, all) => known.has(entry.terminalId) && all.findIndex((other) => other.terminalId === entry.terminalId) === index);
  const { terminalNames: _names, ...base } = migrated;
  const next: WorkspaceLayout = {
    ...base, tabs, activeTabId: focused.id, selectedTerminalId: selected,
    maximizedTerminalId: migrated.maximizedTerminalId && panes.includes(migrated.maximizedTerminalId) && tabs.length > 1 ? migrated.maximizedTerminalId : null,
    dock: alignGroups(migrated.dock, tabs.map((tab) => tab.id)) ?? { group: focused.id },
    ...(names.length ? { terminalNames: names } : {}),
  };
  return settle(layout, next);
}

/**
 * 旧布局（工作区页签＋平铺）→ 标签组：当前工作区里并排显示的每个窗口各成一组、按原来的横排／纵排／网格与比例摆放，
 * 其余工作区的 CLI 作为后台标签依次放进这些组；原来只有一个窗口或放大着的，全部进一组。
 */
export function migrateLegacyTabs(layout: WorkspaceLayout, newId: () => string): WorkspaceLayout {
  const active = layout.tabs.find((tab) => tab.id === layout.activeTabId) ?? layout.tabs[0]!;
  const zoomed = layout.maximizedTerminalId && active.paneOrder.includes(layout.maximizedTerminalId) ? [layout.maximizedTerminalId] : undefined;
  const shown = (zoomed ?? active.paneOrder).slice(0, GROUP_LIMIT);
  const rest = layout.tabs.flatMap((tab) => tab.paneOrder).filter((id) => !shown.includes(id));
  const groups = shown.length > 1 ? shown.map((id, index) => newGroup(index === 0 ? active.id : newId(), active.name, [id])) : [newGroup(active.id, active.name, shown)];
  for (const id of rest) {
    const target = groups.find((group) => group.paneOrder.length < TABS_PER_GROUP);
    if (target) target.paneOrder.push(id);
    else if (groups.length < GROUP_LIMIT) groups.push(newGroup(newId(), active.name, [id]));
  }
  for (const group of groups) group.activeTerminalId ??= group.paneOrder[0];
  const arranged = shown.length > 1 ? arrange(groups.slice(0, shown.length).map((group) => ({ group: group.id })), active.layout, active.ratios) : { group: groups[0]!.id };
  const focused = groups.find((group) => layout.selectedTerminalId && group.paneOrder.includes(layout.selectedTerminalId)) ?? groups[0]!;
  // 放不进并排那几组的（极端情况下新开的组）补在最右边。
  return { ...layout, tabs: groups, activeTabId: focused.id, maximizedTerminalId: null, dock: alignGroups(tidy(arranged), groups.map((group) => group.id)) };
}

function arrange(leaves: DockNode[], mode: WorkspaceTab['layout'], ratios: WorkspaceTab['ratios']): DockNode {
  const weights = (values: readonly number[], length: number) => Array.from({ length }, (_, index) => values[index] ?? 1);
  if (mode === 'columns') return { direction: 'row', children: leaves, sizes: weights(ratios.columns, leaves.length) };
  if (mode === 'rows') return { direction: 'column', children: leaves, sizes: weights(ratios.rows, leaves.length) };
  const rows: DockNode[] = [];
  for (let index = 0; index < leaves.length; index += 2) {
    const pair = leaves.slice(index, index + 2);
    rows.push(pair.length === 2 ? { direction: 'row', children: pair, sizes: weights(ratios.columns, 2) } : pair[0]!);
  }
  return rows.length === 1 ? rows[0]! : { direction: 'column', children: rows, sizes: weights(ratios.rows, rows.length) };
}

/**
 * 与名册对账：在运行的 CLI（启动中、运行中、状态未确认）都要有标签——布局里没有它的，或只在已关闭列表里的，放进焦点组做后台标签；
 * 本页刚结束并关掉、名册还没跟上的（`dismissed`）不放回。已结束或失败、布局里又没有的，只记进已关闭列表。布局从不启动或结束进程。
 */
export function reconcileTerminals(layout: WorkspaceLayout, roster: readonly Pick<NativeTerminalDto, 'terminalId' | 'lifecycle'>[], dismissed: ReadonlySet<string>): WorkspaceLayout {
  let next = layout;
  for (const terminal of roster) {
    if (groupOf(next, terminal.terminalId)) continue;
    if (isLiveTerminal(terminal) && !dismissed.has(terminal.terminalId)) next = openTerminal(next, terminal.terminalId, { activate: false });
    else if (!next.hiddenTerminalIds.includes(terminal.terminalId)) next = { ...next, hiddenTerminalIds: [...next.hiddenTerminalIds, terminal.terminalId] };
  }
  return settle(layout, next);
}

/**
 * 放进焦点组（满了放进第一个有空位的组；都满了就在焦点组右边分出一组）；`activate` 时成为当前标签并取得焦点，
 * 否则只是后台标签（空组除外）。布局的 CLI 总数到上限时原样返回。
 */
export function openTerminal(layout: WorkspaceLayout, terminalId: string, options: { readonly activate: boolean }): WorkspaceLayout {
  if (groupOf(layout, terminalId)) return options.activate ? activateTerminal(layout, terminalId) : layout;
  const count = layout.tabs.reduce((sum, tab) => sum + tab.paneOrder.length, 0) + layout.hiddenTerminalIds.filter((id) => id !== terminalId).length;
  const focused = layout.tabs.find((tab) => tab.id === layout.activeTabId) ?? layout.tabs[0]!;
  const target = focused.paneOrder.length < TABS_PER_GROUP ? focused : layout.tabs.find((tab) => tab.paneOrder.length < TABS_PER_GROUP);
  if (count >= LAYOUT_TERMINALS || !target && layout.tabs.length >= GROUP_LIMIT) return layout;
  const hiddenTerminalIds = layout.hiddenTerminalIds.filter((id) => id !== terminalId);
  let next: WorkspaceLayout;
  if (target) {
    const tabs = layout.tabs.map((tab) => tab.id === target.id ? { ...tab, paneOrder: [...tab.paneOrder, terminalId], activeTerminalId: options.activate || !tab.activeTerminalId ? terminalId : tab.activeTerminalId } : tab);
    next = { ...layout, tabs, hiddenTerminalIds };
  } else {
    const id = newDraftResourceId(), dock = splitGroup(layoutDock(layout), focused.id, 'right', id) ?? alignGroups(layoutDock(layout), [...layout.tabs.map((tab) => tab.id), id]);
    next = { ...layout, tabs: [...layout.tabs, newGroup(id, focused.name, [terminalId])], hiddenTerminalIds, dock };
  }
  return options.activate ? activateTerminal(next, terminalId) : next;
}

/**
 * 原位替换（RFC-022 Q2）：重试启动失败的 CLI 时，新 CLI 占据旧标签在组里的位置并成为当前标签，自定义名字随之转过去；
 * 旧的记进已关闭列表。旧标签已不在布局里时按普通新开处理。
 */
export function replaceTerminal(layout: WorkspaceLayout, oldId: string, newId: string): WorkspaceLayout {
  const group = groupOf(layout, oldId);
  if (!group || groupOf(layout, newId)) return openTerminal(layout, newId, { activate: true });
  const swap = (id: string | null | undefined) => (id === oldId ? newId : id);
  const tabs = layout.tabs.map((tab) => tab.id === group.id ? { ...tab, paneOrder: tab.paneOrder.map((id) => swap(id)!), activeTerminalId: newId } : tab);
  const names = (layout.terminalNames ?? []).map((entry) => (entry.terminalId === oldId ? { ...entry, terminalId: newId } : entry));
  return activateTerminal({
    ...layout, tabs, hiddenTerminalIds: [...layout.hiddenTerminalIds.filter((id) => id !== oldId && id !== newId), oldId],
    selectedTerminalId: swap(layout.selectedTerminalId) ?? null, maximizedTerminalId: swap(layout.maximizedTerminalId) ?? null,
    ...(layout.terminalNames ? { terminalNames: names } : {}),
  }, newId);
}

/** 让它成为所在组的当前标签、所在组成为焦点组；别的组正放大着时先还原，免得选中的看不见。 */
export function activateTerminal(layout: WorkspaceLayout, terminalId: string): WorkspaceLayout {
  const group = groupOf(layout, terminalId);
  if (!group) return layout;
  const big = maximizedGroup(layout);
  return settle(layout, {
    ...layout, tabs: layout.tabs.map((tab) => tab.id === group.id ? { ...tab, activeTerminalId: terminalId } : tab),
    activeTabId: group.id, selectedTerminalId: terminalId, maximizedTerminalId: big && big.id !== group.id ? null : layout.maximizedTerminalId,
  });
}

/** 点进或聚焦到某组：它成为焦点组（新开的 CLI 落在这里）。 */
export function focusGroup(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  const group = layout.tabs.find((tab) => tab.id === groupId);
  if (!group || layout.activeTabId === groupId && layout.selectedTerminalId === (group.activeTerminalId ?? null)) return layout;
  return { ...layout, activeTabId: groupId, selectedTerminalId: group.activeTerminalId ?? null };
}

/** 关掉一个标签（进程已由调用方结束，或本来就已结束）：记进已关闭列表，同组相邻的标签接替显示，空组随之消失。 */
export function closeTerminal(layout: WorkspaceLayout, terminalId: string): WorkspaceLayout {
  const group = groupOf(layout, terminalId);
  if (!group) return layout;
  const rest = withoutTerminal(group, terminalId), successor = rest.activeTerminalId;
  const tabs = layout.tabs.map((tab) => tab.id === group.id ? rest : tab);
  const names = (layout.terminalNames ?? []).filter((entry) => entry.terminalId !== terminalId);
  const { terminalNames: _names, ...base } = layout;
  const next: WorkspaceLayout = {
    ...base, tabs, hiddenTerminalIds: [...layout.hiddenTerminalIds.filter((id) => id !== terminalId), terminalId],
    selectedTerminalId: layout.selectedTerminalId === terminalId ? successor ?? null : layout.selectedTerminalId,
    maximizedTerminalId: layout.maximizedTerminalId === terminalId ? successor ?? null : layout.maximizedTerminalId,
    ...(names.length ? { terminalNames: names } : {}),
  };
  return dropEmptyGroups(next);
}

function dropEmptyGroups(layout: WorkspaceLayout): WorkspaceLayout {
  const empty = layout.tabs.filter((tab) => tab.paneOrder.length === 0);
  if (!empty.length || empty.length === layout.tabs.length && layout.tabs.length === 1) return layout;
  const tabs = layout.tabs.filter((tab) => tab.paneOrder.length > 0);
  const kept = tabs.length ? tabs : [layout.tabs[0]!];
  let dock: DockNode | undefined = layoutDock(layout);
  for (const tab of empty) if (kept.every((other) => other.id !== tab.id)) dock = dock && removeGroup(dock, tab.id);
  const focused = kept.find((tab) => tab.id === layout.activeTabId) ?? kept.find((tab) => layout.selectedTerminalId && tab.paneOrder.includes(layout.selectedTerminalId)) ?? kept[0]!;
  return { ...layout, tabs: kept, activeTabId: focused.id, dock: dock ?? { group: kept[0]!.id } };
}

/** 这次放下会不会改变什么：原地放回、拖进已满的组、把组里唯一的标签分到自己旁边、分组超出上限的都不算。 */
export function acceptsDrop(layout: WorkspaceLayout, terminalId: string, drop: DockDrop): boolean {
  const source = groupOf(layout, terminalId), target = layout.tabs.find((tab) => tab.id === drop.group);
  if (!source || !target) return false;
  if (drop.kind === 'split') return layout.tabs.length < GROUP_LIMIT && !(target.id === source.id && source.paneOrder.length === 1) && !!splitGroup(layoutDock(layout), target.id, drop.side, 'probe');
  if (target.id !== source.id) return target.paneOrder.length < TABS_PER_GROUP;
  if (drop.kind === 'center') return false;
  const at = source.paneOrder.indexOf(terminalId);
  return drop.index !== at && drop.index !== at + 1;
}

/** 放下：插进某组的标签栏、并入某组，或分到某组的一边成为新组（`newGroupId`）。 */
export function dropTerminal(layout: WorkspaceLayout, terminalId: string, drop: DockDrop, newGroupId: string): WorkspaceLayout {
  if (!acceptsDrop(layout, terminalId, drop)) return layout;
  const source = groupOf(layout, terminalId)!;
  if (drop.kind === 'split') {
    const dock = splitGroup(layoutDock(layout), drop.group, drop.side, newGroupId);
    if (!dock) return layout;
    const tabs = [...layout.tabs.map((tab) => tab.id === source.id ? withoutTerminal(tab, terminalId) : tab), newGroup(newGroupId, source.name, [terminalId])];
    return dropEmptyGroups({ ...layout, tabs, dock, activeTabId: newGroupId, selectedTerminalId: terminalId, maximizedTerminalId: null });
  }
  const target = layout.tabs.find((tab) => tab.id === drop.group)!;
  const order = target.paneOrder.filter((id) => id !== terminalId);
  const original = target.paneOrder.indexOf(terminalId), requested = drop.kind === 'tab' ? drop.index : target.paneOrder.length;
  order.splice(original >= 0 && original < requested ? requested - 1 : requested, 0, terminalId);
  const tabs = layout.tabs.map((tab) => tab.id === target.id ? { ...tab, paneOrder: order, activeTerminalId: terminalId } : tab.id === source.id ? withoutTerminal(tab, terminalId) : tab);
  const big = maximizedGroup(layout);
  return dropEmptyGroups({ ...layout, tabs, activeTabId: target.id, selectedTerminalId: terminalId, maximizedTerminalId: big && big.id !== target.id ? null : layout.maximizedTerminalId });
}

function withoutTerminal(tab: WorkspaceTab, terminalId: string): WorkspaceTab {
  const at = tab.paneOrder.indexOf(terminalId), order = tab.paneOrder.filter((id) => id !== terminalId);
  const active = tab.activeTerminalId === terminalId ? order[Math.min(at, order.length - 1)] : tab.activeTerminalId;
  const { activeTerminalId: _old, ...rest } = tab;
  return { ...rest, paneOrder: order, ...(active ? { activeTerminalId: active } : {}) };
}

/** 右键菜单的「向左／右／上／下分屏」：把这个标签分到所在组的那一边。 */
export function splitTerminal(layout: WorkspaceLayout, terminalId: string, side: DockSide, newGroupId: string): WorkspaceLayout {
  const group = groupOf(layout, terminalId);
  return group ? dropTerminal(layout, terminalId, { kind: 'split', group: group.id, side }, newGroupId) : layout;
}

/** 双击标签：放大这一组占满 CLI 区，再双击还原。只有一组时放大没有意义。 */
export function toggleMaximize(layout: WorkspaceLayout, terminalId: string): WorkspaceLayout {
  const group = groupOf(layout, terminalId);
  if (!group) return layout;
  if (maximizedGroup(layout)?.id === group.id) return { ...layout, maximizedTerminalId: null };
  if (layout.tabs.length < 2) return layout;
  return { ...activateTerminal(layout, terminalId), maximizedTerminalId: terminalId };
}

/** 只改自己看到的名字；空名字恢复默认名。 */
export function renameTerminal(layout: WorkspaceLayout, terminalId: string, name: string): WorkspaceLayout {
  const rest = (layout.terminalNames ?? []).filter((entry) => entry.terminalId !== terminalId), trimmed = name.trim();
  if (!groupOf(layout, terminalId) || trimmed.length > 40) return layout;
  const names = trimmed ? [...rest, { terminalId, name: trimmed }] : rest;
  const { terminalNames: _names, ...base } = layout;
  return settle(layout, { ...base, ...(names.length ? { terminalNames: names } : {}) });
}

export function resizeGroups(layout: WorkspaceLayout, path: DockPath, sizes: readonly number[]): WorkspaceLayout {
  return settle(layout, { ...layout, dock: setSizes(layoutDock(layout), path, sizes) });
}
export function equalizeGroups(layout: WorkspaceLayout, path: DockPath): WorkspaceLayout {
  return settle(layout, { ...layout, dock: equalizeSizes(layoutDock(layout), path) });
}

/** 按顺序列出所有标签（窄屏合并成一条标签栏时用）：先按分屏树的组序，组内按标签序。 */
export function orderedTerminals(layout: WorkspaceLayout): string[] {
  return dockGroups(layoutDock(layout)).flatMap((id) => layout.tabs.find((tab) => tab.id === id)?.paneOrder ?? []);
}
