import type { Logger } from '@crewstation/kernel';
import type { ProcessLauncher } from '../process/launcher';
import { killProcessTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';
import { TERMINAL_HANGUP_GRACE_MS } from './nativePty';
import type { PtyBackend, PtySession } from './ptyBackend';

export function scriptBinaryAvailable(): boolean {
  return Bun.which('script') !== null;
}

/**
 * 回退终端：没有 Bun.Terminal 时用 util-linux 的 `script -qfc "<shell>" /dev/null` 给 shell 一个 PTY，
 * 输入经 stdin 管道转进去；窗口大小只能在启动时经 COLUMNS／LINES 给出，之后的 resize 是 no-op。
 * macOS 的 BSD script 参数形式不同，这里按平台区分只为让本地开发机也能跑通。
 */
export function createScriptPtyBackend(launcher: ProcessLauncher, logger: Logger): PtyBackend {
  return {
    kind: 'script',
    open(options): PtySession {
      const shell = options.cmd.map(shellQuote).join(' ');
      const cmd = process.platform === 'linux' ? ['script', '-qfc', shell, '/dev/null'] : ['script', '-q', '/dev/null', ...options.cmd];
      const env = { ...options.env, COLUMNS: String(options.cols), LINES: String(options.rows) };
      const proc = launcher.spawnWithStdin({ cmd, cwd: options.cwd, env });
      void pumpStream(proc.stdout, options.onData);
      void pumpStream(proc.stderr, options.onData);
      let resizeWarned = false;
      return {
        write(data) {
          proc.stdin.write(data);
          void proc.stdin.flush();
        },
        resize() {
          if (resizeWarned) return;
          resizeWarned = true;
          logger.warn('terminal resize ignored: script(1) fallback cannot change the PTY window size');
        },
        close: () => killProcessTree(proc, TERMINAL_HANGUP_GRACE_MS, 'SIGHUP'),
        exited: proc.exited.then(() => proc.exitCode),
      };
    },
  };
}

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
