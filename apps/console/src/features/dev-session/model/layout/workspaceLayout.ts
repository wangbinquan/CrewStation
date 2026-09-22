import { newDraftResourceId } from '@crewstation/api-client';
import type { WorkspaceLayout, WorkspaceTab, WorkspaceTool, WorkspaceToolName } from '@crewstation/contracts';

export function newWorkspaceTab(name: string): WorkspaceTab {
  return { id: newDraftResourceId(), name, layout: 'grid', paneOrder: [], ratios: { columns: [1, 1], rows: [1, 1] } };
}
export function initialWorkspaceLayout(name: string): WorkspaceLayout {
  const tab = newWorkspaceTab(name);
  return { activeTabId: tab.id, tabs: [tab], hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null };
}
export function updateWorkspaceTab(layout: WorkspaceLayout, id: string, update: (tab: WorkspaceTab) => WorkspaceTab): WorkspaceLayout {
  return { ...layout, tabs: layout.tabs.map((tab) => tab.id === id ? update(tab) : tab) };
}
export function addWorkspaceTab(layout: WorkspaceLayout, name: string): WorkspaceLayout {
  if (layout.tabs.length >= 16) return layout;
  const tab = newWorkspaceTab(name);
  return { ...layout, tabs: [...layout.tabs, tab], activeTabId: tab.id, maximizedTerminalId: null };
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
  const visible = (value: WorkspaceLayout) => { const tool = layoutTool(value); return tool?.mode === 'full' ? withTool(value, { ...tool, mode: 'side' }) : value; };
  const current = layout.tabs.find((tab) => tab.paneOrder.includes(terminalId));
  if (current) return layoutTool(layout)?.mode !== 'full' && layout.activeTabId === current.id && layout.selectedTerminalId === terminalId && (!layout.maximizedTerminalId || layout.maximizedTerminalId === terminalId) ? layout : visible({ ...layout, activeTabId: current.id, selectedTerminalId: terminalId, maximizedTerminalId: null });
  const target = layout.tabs.find((tab) => tab.id === layout.activeTabId && tab.paneOrder.length < 32) ?? layout.tabs.find((tab) => tab.paneOrder.length < 32);
  const next = target ? layout : addWorkspaceTab(layout, tabName);
  const targetId = target?.id ?? next.activeTabId;
  return visible({ ...moveTerminal(next, terminalId, targetId), activeTabId: targetId, maximizedTerminalId: null });
}

/** 工具面板（RFC-020 D1）。旧布局没有 `tool` 字段时从 `view`／`previewAlongside` 推出等价状态。 */
export const TOOL_NAMES: readonly WorkspaceToolName[] = ['preview', 'code', 'changes', 'data', 'reference', 'session'];
export function layoutTool(layout: WorkspaceLayout): WorkspaceTool | undefined {
  if (layout.tool) return layout.tool;
  if (layout.previewAlongside) return { name: 'preview', mode: 'side', ratio: Math.min(0.6, Math.max(0.3, layout.previewRatio)) };
  if (layout.view !== 'cli') return { name: layout.view, mode: 'full', ratio: Math.min(0.6, Math.max(0.3, layout.previewRatio)) };
  return undefined;
}
/** 写入面板状态并回填旧字段：旧工作台读到的 `view` 与 `previewAlongside` 和面板一致。 */
export function withTool(layout: WorkspaceLayout, tool: WorkspaceTool | undefined): WorkspaceLayout {
  const current = layoutTool(layout);
  if (current?.name === tool?.name && current?.mode === tool?.mode && current?.ratio === tool?.ratio && (layout.tool !== undefined) === (tool !== undefined)) return layout;
  const legacy = tool?.mode === 'full' && (tool.name === 'preview' || tool.name === 'code' || tool.name === 'changes') ? tool.name : 'cli';
  const previewAlongside = tool?.name === 'preview' && tool.mode === 'side';
  const { tool: _dropped, ...rest } = layout;
  // previewRatio 兼作面板宽度的记忆：收起再打开仍是上次的宽度。
  return { ...rest, ...(tool ? { tool } : {}), view: legacy, previewAlongside, previewRatio: tool ? tool.ratio : current?.ratio ?? layout.previewRatio };
}
