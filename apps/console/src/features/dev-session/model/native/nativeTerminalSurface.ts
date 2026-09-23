import type { AgentProtocol, TerminalSnapshot } from '@crewstation/contracts';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { NativeTerminalSink } from './nativeTerminalAttachment';
import { terminalLook, watchTerminalTheme } from '../terminalTheme';
import { installQueryFilter } from './terminalQueryFilter';

/** xterm 的生命周期只拥有 DOM；所有 PTY 命令由 attachment 控制。 */
export class NativeTerminalSurface implements NativeTerminalSink {
  private terminal?: Terminal;
  private fit?: FitAddon;
  private observer?: ResizeObserver;
  private stopTheme?: () => void;
  private stopScroll?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<void> = Promise.resolve();
  private controlled = false;
  private queryFilter?: { dispose(): void };
  constructor(private readonly protocol?: AgentProtocol) {}
  mount(container: HTMLElement, input: (data: string) => void, resize: (cols: number, rows: number) => void): void {
    const look = terminalLook(container);
    const terminal = new Terminal({ ...look, fontSize: 12, cursorBlink: true, scrollback: 500, disableStdin: true });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container);
    this.terminal = terminal; this.fit = fit;
    const readOnlyScroll = (event: WheelEvent): void => {
      if (this.controlled) return;
      const horizontal = (event.deltaX !== 0 || event.shiftKey) && container.scrollWidth > container.clientWidth;
      const vertical = event.deltaY !== 0 && !event.shiftKey && container.scrollHeight > container.clientHeight;
      // xterm 的内部滚轮处理会取消默认滚动；只读小窗让浏览器滚动外层原尺寸画面。
      if (horizontal || vertical) event.stopPropagation();
    };
    container.addEventListener('wheel', readOnlyScroll, { capture: true });
    this.stopScroll = () => container.removeEventListener('wheel', readOnlyScroll, { capture: true });
    terminal.onData(input);
    terminal.onResize(({ cols, rows }) => {
      if (!this.controlled) return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => resize(cols, rows), 80);
    });
    this.observer = new ResizeObserver(() => this.fitVisible()); this.observer.observe(container);
    this.stopTheme = watchTerminalTheme(container, (theme) => { terminal.options.theme = theme; });
  }
  setControlled(controlled: boolean): void {
    this.controlled = controlled;
    if (this.terminal) this.terminal.options.disableStdin = !controlled;
    if (controlled) this.fitVisible();
  }
  focus(): void { this.terminal?.focus(); }
  fitVisible(): void { if (this.controlled) { try { this.fit?.fit(); } catch { /* 等待可见尺寸 */ } } }
  restore(snapshot: TerminalSnapshot): Promise<void> {
    const terminal = this.terminal;
    if (!terminal) return Promise.resolve();
    this.tail = this.tail.then(() => {
      if (this.terminal !== terminal) return;
      this.filterQueries(terminal, snapshot.repliesQueries === true);
      terminal.reset(); terminal.resize(snapshot.cols, snapshot.rows);
      // 旧 Runner 的 addon-serialize 遗漏编码：只兼容已知使用 SGR 的 OpenCode，保留新快照的明确模式。
      const legacyOpencode = this.protocol === 'opencode' && /\x1b\[\?(?:\d+;)*100[023](?:;\d+)*h/.test(snapshot.data)
        && !/\x1b\[\?(?:\d+;)*(?:1006|1016)(?:;\d+)*[hl]/.test(snapshot.data);
      return new Promise<void>((resolve) => terminal.write(snapshot.data + (legacyOpencode ? '\x1b[?1006h' : ''), resolve));
    });
    return this.tail;
  }
  /** RFC-026：Runner 声明由它应答终端查询时拦下查询，旧 Runner 由浏览器照旧应答；每次附着按快照重新决定。 */
  private filterQueries(terminal: Terminal, runnerReplies: boolean): void {
    if (runnerReplies && !this.queryFilter) this.queryFilter = installQueryFilter(terminal);
    if (!runnerReplies && this.queryFilter) { this.queryFilter.dispose(); this.queryFilter = undefined; }
  }
  write(data: string): void {
    const terminal = this.terminal;
    this.tail = this.tail.then(() => {
      if (!terminal || this.terminal !== terminal) return;
      return new Promise<void>((resolve) => terminal.write(data, resolve));
    });
  }
  resize(cols: number, rows: number): void {
    const terminal = this.terminal;
    this.tail = this.tail.then(() => { if (terminal && this.terminal === terminal) terminal.resize(cols, rows); });
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.observer?.disconnect(); this.stopTheme?.(); this.stopScroll?.(); this.queryFilter?.dispose(); this.queryFilter = undefined; this.terminal?.dispose();
    this.stopTheme = undefined; this.stopScroll = undefined;
    this.terminal = undefined; this.fit = undefined; this.controlled = false; this.tail = Promise.resolve();
  }
}
