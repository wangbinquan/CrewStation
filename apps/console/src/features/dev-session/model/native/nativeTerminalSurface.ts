import type { TerminalSnapshot } from '@crewstation/contracts';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { NativeTerminalSink } from './nativeTerminalAttachment';
import { terminalLook, watchTerminalTheme } from '../terminalTheme';

/** xterm 的生命周期只拥有 DOM；所有 PTY 命令由 attachment 控制。 */
export class NativeTerminalSurface implements NativeTerminalSink {
  private terminal?: Terminal;
  private fit?: FitAddon;
  private observer?: ResizeObserver;
  private stopTheme?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private tail: Promise<void> = Promise.resolve();
  private controlled = false;
  mount(container: HTMLElement, input: (data: string) => void, resize: (cols: number, rows: number) => void): void {
    const look = terminalLook(container);
    const terminal = new Terminal({ ...look, fontSize: 12, cursorBlink: true, scrollback: 500, disableStdin: true });
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(container);
    this.terminal = terminal; this.fit = fit;
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
      terminal.reset(); terminal.resize(snapshot.cols, snapshot.rows);
      return new Promise<void>((resolve) => terminal.write(snapshot.data, resolve));
    });
    return this.tail;
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
    this.observer?.disconnect(); this.stopTheme?.(); this.terminal?.dispose();
    this.stopTheme = undefined;
    this.terminal = undefined; this.fit = undefined; this.controlled = false; this.tail = Promise.resolve();
  }
}
