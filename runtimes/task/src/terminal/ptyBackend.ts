export interface PtyOpenOptions {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
  onData: (text: string) => void;
}

export interface PtySession {
  write(data: string): void;
  /** 原生 PTY 真正改窗口大小；script(1) 回退只能尽力（no-op）。 */
  resize(cols: number, rows: number): void;
  /** 杀进程树并释放 PTY。 */
  close(): Promise<void>;
  /** shell 退出码（被信号终止为 null）。 */
  readonly exited: Promise<number | null>;
}

export type PtyBackendKind = 'native' | 'script';

export interface PtyBackend {
  readonly kind: PtyBackendKind;
  open(options: PtyOpenOptions): PtySession;
}
