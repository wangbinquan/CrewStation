import { newDraftResourceId } from '@crewstation/api-client';
import type { WorkspaceLayout, WorkspaceTab, WorkspaceTool, WorkspaceToolName } from '@crewstation/contracts';
import { activateTerminal, groupOf, newGroup, openTerminal } from './terminalGroups';

export function newWorkspaceTab(name: string): WorkspaceTab {
  return newGroup(newDraftResourceId(), name);
}
/** 一个空组：还没有 CLI 时 CLI 区显示「＋ 新开 CLI」。 */
export function initialWorkspaceLayout(name: string): WorkspaceLayout {
  const tab = newWorkspaceTab(name);
  return { activeTabId: tab.id, tabs: [tab], hiddenTerminalIds: [], view: 'cli', previewAlongside: false, previewRatio: 0.45, selectedTerminalId: null, maximizedTerminalId: null, dock: { group: tab.id } };
}

/** 定位（动态通知、地址里的 CLI）：让它显示出来并成为焦点；已关掉的在运行的 CLI 重新放进焦点组。放大的面板退回在旁，终端才看得见。不取得输入控制。 */
export function revealTerminal(layout: WorkspaceLayout, terminalId: string): WorkspaceLayout {
  const shown = groupOf(layout, terminalId) ? activateTerminal(layout, terminalId) : openTerminal(layout, terminalId, { activate: true });
  const tool = layoutTool(shown);
  return tool?.mode === 'full' ? withTool(shown, { ...tool, mode: 'side' }) : shown;
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
