import type { WorkspaceTool, WorkspaceToolName } from '@crewstation/contracts';
import type { DevelopmentSearch, DevelopmentView } from '../../../../shared/project/developmentSearch';

export interface WorkspaceLocation {
  readonly key: string; readonly search: DevelopmentSearch;
  readonly selectView: (view: DevelopmentView) => void;
  /** 打开／切换工具面板（null＝收起）；replace 用于把布局里的面板写回没有参数的地址。 */
  readonly selectTool: (tool: { name: WorkspaceToolName; mode: 'side' | 'full' } | null, replace?: boolean) => void;
}
export function locationView(search: DevelopmentSearch) {
  return search.view === 'changes' ? 'diff' : search.view ?? (search.file ? 'code' : search.agent || search.terminal ? 'cli' : search.target ? 'diff' : undefined);
}
/**
 * 地址 → 面板指令：`view=cli` 收起（null）；`split` 是「预览在旁」的别名；`diff`／`changes` 都是变更；
 * 其余工具按 `panel` 取形态（缺省在旁）。没有指令返回 undefined，由个人布局决定。
 */
export function locationTool(search: DevelopmentSearch): { name: WorkspaceToolName; mode: 'side' | 'full' } | null | undefined {
  const view = locationView(search);
  if (view === undefined || view === 'conversation') return undefined;
  if (view === 'cli') return null;
  if (view === 'split') return { name: 'preview', mode: 'side' };
  const name: WorkspaceToolName = view === 'diff' ? 'changes' : view;
  return { name, mode: search.panel === 'full' ? 'full' : 'side' };
}
/** 面板状态 → 地址：在旁的工具只写 `view`，放大的补 `panel=full`；收起写 `view=cli`。 */
export function toolSearch(tool: Pick<WorkspaceTool, 'name' | 'mode'> | null, base: DevelopmentSearch): DevelopmentSearch {
  // 只带有值的参数：undefined 的键会原样进入路由状态，让地址对比与用例的 toEqual 都失真。
  const rest = Object.fromEntries(Object.entries(base).filter(([key, value]) => key !== 'view' && key !== 'panel' && value !== undefined)) as DevelopmentSearch;
  if (!tool) return { ...rest, view: 'cli' };
  return { ...rest, view: tool.name, ...(tool.mode === 'full' ? { panel: 'full' as const } : {}) };
}
