import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import type { WorkspaceLayout, WorkspaceTool, WorkspaceToolName } from '@crewstation/contracts';
import type { WorkspaceLayoutStore } from '../../model/layout/workspaceLayoutStore';
import type { WorkspaceLocation } from '../../model/layout/developmentLocation';
import { locationTool } from '../../model/layout/developmentLocation';
import { layoutTool, withTool } from '../../model/layout/workspaceLayout';

/** 内容区窄于这个宽度时面板只有放大形态：终端与面板并排都不可用（RFC-020 design §5.1）。 */
export const NARROW_WIDTH = 800;
export const MIN_RATIO = 0.3, MAX_RATIO = 0.6;

/**
 * 面板的打开／形态以地址为准（显式地址优先于其他浏览器页保存的个人布局，RFC-008）；没有地址指令时用个人布局。
 * 选择／放大／收起只改地址，`useWorkspaceLocation` 再把地址同步进布局；分隔线拖动只写比例。窄屏强制放大只影响显示。
 */
export function useToolPanel(layout: WorkspaceLayout, store: WorkspaceLayoutStore, location: WorkspaceLocation | undefined, root: RefObject<HTMLDivElement | null>) {
  const saved = layoutTool(layout), instruction = location ? locationTool(location.search) : undefined;
  const savedKey = saved ? `${saved.name}:${saved.mode}:${saved.ratio}` : '', instructionKey = instruction === undefined ? 'none' : instruction === null ? 'closed' : `${instruction.name}:${instruction.mode}`;
  const tool = useMemo((): WorkspaceTool | undefined => {
    const [name, mode, ratio] = savedKey.split(':'), base = savedKey ? { name: name as WorkspaceToolName, mode: mode as 'side' | 'full', ratio: Number(ratio) } : undefined;
    if (instructionKey === 'none') return base;
    if (instructionKey === 'closed') return undefined;
    const [toolName, toolMode] = instructionKey.split(':');
    return { name: toolName as WorkspaceToolName, mode: toolMode as 'side' | 'full', ratio: base?.ratio ?? 0.45 };
  }, [savedKey, instructionKey]);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = root.current; if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setNarrow(entry.contentRect.width > 0 && entry.contentRect.width < NARROW_WIDTH); });
    observer.observe(element); return () => observer.disconnect();
  }, [root]);
  const apply = useCallback((next: WorkspaceTool | undefined) => {
    if (location) location.selectTool(next ? { name: next.name, mode: next.mode } : null);
    else store.update((current) => withTool(current, next));
  }, [store, location]);
  const select = useCallback((name: WorkspaceToolName) => apply({ name, mode: tool?.mode ?? 'side', ratio: tool?.ratio ?? 0.45 }), [apply, tool]);
  const toggleMode = useCallback(() => { if (tool) apply({ ...tool, mode: tool.mode === 'full' ? 'side' : 'full' }); }, [apply, tool]);
  const close = useCallback(() => apply(undefined), [apply]);
  const resize = useCallback((ratio: number) => { if (tool) store.update((current) => withTool(current, { ...tool, ratio: Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) })); }, [store, tool]);
  const mode: 'side' | 'full' | 'closed' = !tool ? 'closed' : narrow ? 'full' : tool.mode;
  return { tool, mode, forcedFull: narrow && !!tool, select, toggleMode, close, resize };
}
