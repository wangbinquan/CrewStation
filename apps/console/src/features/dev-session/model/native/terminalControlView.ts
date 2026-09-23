import type { TerminalHolder } from '@crewstation/contracts';
import type { NativeAttachmentState } from './nativeTerminalAttachment';

/** 终端上方状态条的几种情形；颜色与文案都按它取。 */
export type TerminalControlTone = 'mine' | 'free' | 'self-elsewhere' | 'other' | 'unknown-other' | 'readonly';
export interface TerminalControlView { readonly tone: TerminalControlTone; readonly holder?: TerminalHolder }

/**
 * 状态条显示什么（2026-09-23 裁定：占用人常驻实时显示）：自己在输入、空闲可点、自己在另一窗口、
 * 别人在输入（带名字），以及旧 Runner 看不到是谁时的「其他窗口正在输入」。未就绪时不给，沿用附着阶段的提示。
 */
export function terminalControlView(state: NativeAttachmentState, viewerId: string | undefined, canDevelop: boolean): TerminalControlView | undefined {
  if (state.phase !== 'ready') return undefined;
  if (state.controlled) return { tone: 'mine' };
  const control = state.control;
  if (control?.held) {
    if (!control.holder) return { tone: 'unknown-other' };
    if (canDevelop && viewerId !== undefined && control.holder.userId === viewerId) return { tone: 'self-elsewhere' };
    return { tone: 'other', holder: control.holder };
  }
  if (!canDevelop) return { tone: 'readonly' };
  return !control && state.refused ? { tone: 'unknown-other' } : { tone: 'free' };
}
