import type { Subprocess, Terminal } from 'bun';
import { accessSync, constants } from 'node:fs';
import { chown } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Logger } from '@crewstation/kernel';
import { buildChildEnv } from './childEnvironment';
import type { Isolation } from './privilege';

export type PipedProcess = Subprocess<'ignore', 'pipe', 'pipe'>;
export type StdinPipedProcess = Subprocess<'pipe', 'pipe', 'pipe'>;

export interface LaunchSpec {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
}

/** 所有子进程的唯一出口：统一套上降权前缀、独立进程组与环境变量清理。 */
export interface ProcessLauncher {
  readonly isolation: Isolation;
  /** 子进程基础环境（已剔除 runner 私有变量）；`extra` 覆盖在最后。 */
  baseEnv(extra?: Record<string, string>): Record<string, string>;
  /** 无 stdin、stdout／stderr 管道、独立进程组。 */
  spawnPiped(spec: LaunchSpec): PipedProcess;
  /** stdin 也是管道（script(1) 回退终端用）。 */
  spawnWithStdin(spec: LaunchSpec): StdinPipedProcess;
  /** 挂在 PTY 上（原生终端）。 */
  spawnWithTerminal(spec: LaunchSpec, terminal: Terminal): Subprocess;
  /** 写入文件后把属主交给 worker（root 时）；非 root 是 no-op。 */
  chownToWorker(path: string): Promise<void>;
}

export interface LauncherDeps {
  isolation: Isolation;
  processEnv: Record<string, string | undefined>;
  workerHome: string;
  logger: Logger;
}

export function createProcessLauncher(deps: LauncherDeps): ProcessLauncher {
  const { isolation, logger } = deps;
  const home = isolation.enabled ? deps.workerHome : undefined;
  const baseEnv = (extra?: Record<string, string>): Record<string, string> => buildChildEnv(deps.processEnv, { home, extra });
  const prepare = (kind: string, spec: LaunchSpec): string[] => {
    // 套上 setpriv 后缺失的可执行文件不再让 Bun.spawn 抛错（setpriv 自己以 127 退出），
    // 因此先按子进程的 PATH 解析一次，让 root 与非 root 下的 spawn_failed 语义一致。
    ensureExecutable(spec.cmd, spec.cwd, spec.env);
    logger.debug('spawn', { kind, argv0: spec.cmd[0], argc: spec.cmd.length, cwd: spec.cwd, isolated: isolation.enabled });
    return isolation.wrap(spec.cmd);
  };
  return {
    isolation,
    baseEnv,
    spawnPiped(spec) {
      return Bun.spawn(prepare('piped', spec), { cwd: spec.cwd, env: spec.env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: true });
    },
    spawnWithStdin(spec) {
      return Bun.spawn(prepare('stdin-piped', spec), { cwd: spec.cwd, env: spec.env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: true });
    },
    spawnWithTerminal(spec, terminal) {
      return Bun.spawn(prepare('terminal', spec), { cwd: spec.cwd, env: spec.env, terminal });
    },
    async chownToWorker(path) {
      if (!isolation.enabled) return;
      await chown(path, isolation.uid, isolation.gid);
    },
  };
}

export function ensureExecutable(cmd: string[], cwd: string, env: Record<string, string>): void {
  const head = cmd[0] ?? '';
  const found = head.includes('/') ? isExecutableFile(resolve(cwd, head)) : Bun.which(head, { PATH: env.PATH ?? '', cwd }) !== null;
  if (!found) throw new Error(`executable not found: ${head}`);
}

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
