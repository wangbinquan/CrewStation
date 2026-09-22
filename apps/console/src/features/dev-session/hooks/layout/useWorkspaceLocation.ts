import { useEffect, useRef } from 'react';
import type { NativeTerminalDto } from '@crewstation/contracts';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import type { WorkspaceLocation } from '../../model/layout/developmentLocation';
import { locationTool, locationView } from '../../model/layout/developmentLocation';
import { layoutTool, revealActivityTerminal, withTool } from '../../model/layout/workspaceLayout';

/**
 * 地址 → 布局：显式地址优先于个人布局（RFC-008），面板的打开与形态随地址同步进布局，其他浏览器页的保存不能把它跳走；
 * 没有参数进入时把布局里的面板写回地址（RFC-020 design §5.2）——此前地址栏是 /dev-session，页面却打开上次留下的「变更」。
 */
export function useWorkspaceLocation(taskId: string, location: WorkspaceLocation | undefined, roster: NativeTerminalDto[] | undefined, store: WorkspaceLayoutStore, loaded: boolean, hasActivityTarget: boolean, tabName: string, layoutKey: string) {
  const handled = useRef<string | undefined>(undefined), search = location?.search, view = search && locationView(search), instruction = search ? locationTool(search) : undefined;
  const wantsTerminal = view === 'cli' || view === 'split', terminal = roster?.find((r) => (!search?.agent || r.agentId === search.agent) && (!search?.terminal || r.terminalId === search.terminal));
  const selected = !!search?.agent || !!search?.terminal, wrongTask = !!search?.task && search.task !== taskId;
  const invalid = wrongTask || wantsTerminal && selected && roster !== undefined && !terminal;
  useEffect(() => {
    if (!location || !loaded || hasActivityTarget || invalid || view === 'conversation' || selected && wantsTerminal && !roster) return;
    if (instruction === undefined) {
      if (handled.current === location.key) return;
      handled.current = location.key;
      const tool = layoutTool(store.getState().layout);
      if (tool) location.selectTool({ name: tool.name, mode: tool.mode }, true);
      return;
    }
    const reveal = handled.current !== location.key; handled.current = location.key;
    store.update((current) => {
      const next = reveal && wantsTerminal && selected && terminal ? revealActivityTerminal(current, terminal.terminalId, tabName) : current;
      const ratio = layoutTool(next)?.ratio ?? next.previewRatio;
      return withTool(next, instruction ? { name: instruction.name, mode: instruction.mode, ratio: Math.min(0.6, Math.max(0.3, ratio)) } : undefined);
    });
  // layoutKey 随布局的面板字段变化：其他浏览器页保存的面板到达时，按当前地址把它拉回来。
  }, [location, loaded, hasActivityTarget, invalid, view, instruction, selected, wantsTerminal, roster, terminal, store, tabName, layoutKey]);
  return invalid && !hasActivityTarget ? 'devSession.location.invalid' : undefined;
}
