import type { TaskStreamCommandInput } from '@crewstation/api-client';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { streamErrorMessage } from './runnerErrors';
import { terminalLook, watchTerminalTheme } from './terminalTheme';

/** 终端回滚行数：够翻一次构建日志，又不至于把内存吃满。 */
const SCROLLBACK = 5_000;

export interface TerminalSessionOptions {
  readonly container: HTMLElement;
  readonly terminalId: string;
  readonly send: (input: TaskStreamCommandInput) => Promise<unknown>;
  /** 敲键盘算用户活动，用于刷新会话空闲时间。 */
  readonly onInput: () => void;
  readonly onError: (message: string) => void;
}

export interface TerminalSession {
  readonly terminal: Terminal;
  dispose(): void;
}

function fitQuietly(fit: FitAddon): void {
  // 容器还没布局（宽高为 0）时 fit 会抛，等下一次 ResizeObserver 回调即可。
  try {
    fit.fit();
  } catch {
    return;
  }
}

/**
 * 把 xterm 接到任务流上：先按容器尺寸量出 cols／rows 再 openTerminal，
 * 之后 onData 上行、terminalOutput 下行（由调用方喂进来）、onResize 同步尺寸。
 */
export function openTerminalSession(options: TerminalSessionOptions): TerminalSession {
  const { container, terminalId, send, onInput, onError } = options;
  const look = terminalLook(container);
  const terminal = new Terminal({ cursorBlink: true, fontFamily: look.fontFamily, fontSize: look.fontSize, theme: look.theme, scrollback: SCROLLBACK });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  fitQuietly(fit);

  const fail = (error: unknown): void => onError(streamErrorMessage(error));
  void send({ type: 'openTerminal', terminalId, cols: terminal.cols, rows: terminal.rows }).catch(fail);

  const input = terminal.onData((data) => {
    onInput();
    void send({ type: 'terminalInput', terminalId, data }).catch(fail);
  });
  const resized = terminal.onResize(({ cols, rows }) => {
    void send({ type: 'terminalResize', terminalId, cols, rows }).catch(() => undefined);
  });
  const observer = new ResizeObserver(() => fitQuietly(fit));
  observer.observe(container);
  const stopTheme = watchTerminalTheme(container, (theme) => { terminal.options.theme = theme; });

  return {
    terminal,
    dispose(): void {
      observer.disconnect();
      stopTheme();
      input.dispose();
      resized.dispose();
      // 关闭指令尽力而为：连接可能已随页面一起关掉。
      void send({ type: 'closeTerminal', terminalId }).catch(() => undefined);
      terminal.dispose();
    },
  };
}
