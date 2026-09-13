import type { WorkspaceLayout, WorkspaceTab } from '@crewstation/contracts';

export function newWorkspaceTab(name: string): WorkspaceTab {
  return { id: crypto.randomUUID(), name, layout: 'grid', paneOrder: [], ratios: { columns: [1, 1], rows: [1, 1] } };
}
export function initialWorkspaceLayout(name: string): WorkspaceLayout {
  const tab = newWorkspaceTab(name);
  return { activeTabId: tab.id, tabs: [tab], hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.5, selectedTerminalId: null, maximizedTerminalId: null };
}
export function updateWorkspaceTab(layout: WorkspaceLayout, id: string, update: (tab: WorkspaceTab) => WorkspaceTab): WorkspaceLayout {
  return { ...layout, tabs: layout.tabs.map((tab) => tab.id === id ? update(tab) : tab) };
}
export function addWorkspaceTab(layout: WorkspaceLayout, name: string): WorkspaceLayout {
  if (layout.tabs.length >= 16) return layout;
  const tab = newWorkspaceTab(name);
  return { ...layout, tabs: [...layout.tabs, tab], activeTabId: tab.id, view: 'cli', maximizedTerminalId: null };
}
/** 移动或收起只更改位置，不发送任何进程命令。目标满时保留原布局。 */
export function moveTerminal(layout: WorkspaceLayout, terminalId: string, tabId: string | null): WorkspaceLayout {
  const target = layout.tabs.find((tab) => tab.id === tabId);
  if (tabId !== null && (!target || target.paneOrder.length >= 32 && !target.paneOrder.includes(terminalId))) return layout;
  const tabs = layout.tabs.map((tab) => ({ ...tab, paneOrder: [...tab.paneOrder.filter((id) => id !== terminalId), ...(tab.id === tabId ? [terminalId] : [])] }));
  return {
    ...layout, tabs, hiddenTerminalIds: [...layout.hiddenTerminalIds.filter((id) => id !== terminalId), ...(tabId === null ? [terminalId] : [])],
    selectedTerminalId: tabId ? terminalId : layout.selectedTerminalId === terminalId ? null : layout.selectedTerminalId,
    maximizedTerminalId: layout.maximizedTerminalId === terminalId ? null : layout.maximizedTerminalId,
  };
}
export function closeWorkspaceTab(layout: WorkspaceLayout, tabId: string, fallbackName: string): WorkspaceLayout {
  const closing = layout.tabs.find((tab) => tab.id === tabId);
  if (!closing) return layout;
  const remaining = layout.tabs.filter((tab) => tab.id !== tabId);
  const tabs = remaining.length ? remaining : [newWorkspaceTab(fallbackName)];
  return {
    ...layout, tabs, activeTabId: layout.activeTabId === tabId ? tabs[0]!.id : layout.activeTabId,
    hiddenTerminalIds: [...layout.hiddenTerminalIds, ...closing.paneOrder],
    selectedTerminalId: closing.paneOrder.includes(layout.selectedTerminalId ?? '') ? null : layout.selectedTerminalId,
    maximizedTerminalId: closing.paneOrder.includes(layout.maximizedTerminalId ?? '') ? null : layout.maximizedTerminalId,
  };
}
/** 没有布局的真实进程进入已启动列表；布局从不凭空启动或删除进程。 */
export function reconcileWorkspaceLayout(layout: WorkspaceLayout, terminalIds: readonly string[]): WorkspaceLayout {
  const placed = new Set([...layout.tabs.flatMap((tab) => tab.paneOrder), ...layout.hiddenTerminalIds]);
  const extra = terminalIds.filter((id) => !placed.has(id));
  return extra.length ? { ...layout, hiddenTerminalIds: [...layout.hiddenTerminalIds, ...extra] } : layout;
}
export function reorderTerminal(layout: WorkspaceLayout, tabId: string, terminalId: string, direction: -1 | 1): WorkspaceLayout {
  return updateWorkspaceTab(layout, tabId, (tab) => {
    const order = [...tab.paneOrder], index = order.indexOf(terminalId), next = index + direction;
    if (index < 0 || next < 0 || next >= order.length) return tab;
    [order[index], order[next]] = [order[next]!, order[index]!];
    return { ...tab, paneOrder: order };
  });
}

/** 定位只恢复显示，已有页签内不重排，不取得终端输入控制。 */
export function revealActivityTerminal(layout: WorkspaceLayout, terminalId: string, tabName: string): WorkspaceLayout {
  const current = layout.tabs.find((tab) => tab.paneOrder.includes(terminalId));
  if (current) return layout.view === 'cli' && layout.activeTabId === current.id && layout.selectedTerminalId === terminalId && (!layout.maximizedTerminalId || layout.maximizedTerminalId === terminalId) ? layout : { ...layout, view: 'cli', activeTabId: current.id, selectedTerminalId: terminalId, maximizedTerminalId: null };
  const target = layout.tabs.find((tab) => tab.id === layout.activeTabId && tab.paneOrder.length < 32) ?? layout.tabs.find((tab) => tab.paneOrder.length < 32);
  const next = target ? layout : addWorkspaceTab(layout, tabName);
  const targetId = target?.id ?? next.activeTabId;
  return { ...moveTerminal(next, terminalId, targetId), activeTabId: targetId, view: 'cli', maximizedTerminalId: null };
}
