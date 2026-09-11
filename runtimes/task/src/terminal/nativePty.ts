import type { ProcessLauncher } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import type { PtyBackend, PtySession } from './ptyBackend';

/** 终端关闭时 SIGHUP 之后等待 shell 退出的宽限。 */
export const TERMINAL_HANGUP_GRACE_MS = 1500;

/** Bun 1.3.13 已提供 `Bun.spawn({ terminal })` 与 `Bun.Terminal`（真实 PTY，支持 resize）。 */
export function hasNativePty(): boolean {
  return typeof (Bun as { Terminal?: unknown }).Terminal === 'function';
}

export function createNativePtyBackend(launcher: ProcessLauncher): PtyBackend {
  return {
    kind: 'native',
    open(options): PtySession {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const terminal = new Bun.Terminal({
        cols: options.cols,
        rows: options.rows,
        name: 'xterm-256color',
        data: (_terminal, bytes) => {
          const text = decoder.decode(bytes, { stream: true });
          if (text.length > 0) options.onData(text);
        },
      });
      const proc = launcher.spawnWithTerminal({ cmd: options.cmd, cwd: options.cwd, env: options.env }, terminal);
      const exited = proc.exited.then(() => proc.exitCode).finally(() => {
        // 进程退出后让 PTY 读端把残余输出交完再释放；Bun 的 exit 回调只表示 PTY 生命周期，不是进程退出。
        setTimeout(() => {
          if (!terminal.closed) terminal.close();
        }, 50);
      });
      return {
        write: (data) => {
          if (!terminal.closed) terminal.write(data);
        },
        resize: (cols, rows) => {
          if (!terminal.closed) terminal.resize(cols, rows);
        },
        async close() {
          // 交互式 bash 忽略 SIGTERM：按终端挂断语义先 SIGHUP，短宽限后 SIGKILL。
          await killProcessTree(proc, TERMINAL_HANGUP_GRACE_MS, 'SIGHUP');
          if (!terminal.closed) terminal.close();
        },
        exited,
      };
    },
  };
}
