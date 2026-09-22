import { createContext, useContext } from 'react';

export interface ToolPanelState {
  /** 面板当前形态：在终端旁边，或放大到整个内容区。 */
  readonly mode: 'side' | 'full';
  readonly maximize: () => void;
  readonly restore: () => void;
}

const Context = createContext<ToolPanelState | undefined>(undefined);
export const ToolPanelProvider = Context.Provider;
/** 面板里的内容据此决定紧凑还是完整形态（参考面板在侧栏只列已授权操作，放大后是整页目录）。 */
export function useToolPanel(): ToolPanelState | undefined { return useContext(Context); }
