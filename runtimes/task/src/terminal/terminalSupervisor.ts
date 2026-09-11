import type { RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { CommandOf } from '../commandDispatcher';
import type { TerminalBackendChoice } from '../config';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import { createNativePtyBackend, hasNativePty } from './nativePty';
import type { PtyBackend, PtySession } from './ptyBackend';
import { createScriptPtyBackend, scriptBinaryAvailable } from './scriptPty';

export interface TerminalSupervisor {
  open(command: CommandOf<'openTerminal'>): Promise<void>;
  input(command: CommandOf<'terminalInput'>): Promise<void>;
  resize(command: CommandOf<'terminalResize'>): Promise<void>;
  close(command: CommandOf<'closeTerminal'>): Promise<void>;
  closeAll(): Promise<void>;
  readonly backend: PtyBackend | undefined;
  readonly size: number;
}

export interface TerminalSupervisorDeps {
  choice: TerminalBackendChoice;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
  /** 缺省 `bash -l`，没有 bash 时 `sh -l`。 */
  shell?: string[];
}

export function selectPtyBackend(choice: TerminalBackendChoice, launcher: ProcessLauncher, logger: Logger): PtyBackend | undefined {
  if (choice !== 'script' && hasNativePty()) return createNativePtyBackend(launcher);
  if (choice === 'native') {
    logger.error('CS_TERMINAL_BACKEND=native but Bun.Terminal is unavailable; terminals disabled');
    return undefined;
  }
  if (scriptBinaryAvailable()) return createScriptPtyBackend(launcher, logger);
  logger.error('neither Bun.Terminal nor script(1) is available; terminals disabled');
  return undefined;
}

export function defaultShell(): string[] {
  return Bun.which('bash') !== null ? ['bash', '-l'] : ['sh', '-l'];
}

/** 给用户一个真实 shell：每个 terminalId 一个 PTY 会话，输出原样流回，退出时发 terminalClosed。 */
export function createTerminalSupervisor(deps: TerminalSupervisorDeps): TerminalSupervisor {
  const backend = selectPtyBackend(deps.choice, deps.launcher, deps.logger);
  const shell = deps.shell ?? defaultShell();
  const sessions = new Map<string, PtySession>();
  if (backend) deps.logger.info('terminal backend selected', { backend: backend.kind, shell: shell[0] });
  const lookup = (terminalId: string): PtySession => {
    const session = sessions.get(terminalId);
    if (!session) throw notFound(`terminal ${terminalId}`);
    return session;
  };
  return {
    backend,
    async open(command) {
      if (!backend) throw new RunnerCommandError('pty_unavailable', '本容器没有可用的 PTY 后端');
      if (sessions.has(command.terminalId)) throw alreadyExists('terminal_exists', `terminal ${command.terminalId}`);
      const cwd = await deps.paths.resolveCwd(command.cwd);
      const env = deps.launcher.baseEnv({ TERM: 'xterm-256color', COLUMNS: String(command.cols), LINES: String(command.rows) });
      const session = backend.open({ cmd: shell, cwd, env, cols: command.cols, rows: command.rows, onData: (data) => deps.emit({ kind: 'terminalOutput', terminalId: command.terminalId, data }) });
      sessions.set(command.terminalId, session);
      deps.logger.info('terminal opened', { terminalId: command.terminalId, cols: command.cols, rows: command.rows });
      void session.exited.then((exitCode) => {
        if (sessions.get(command.terminalId) !== session) return;
        sessions.delete(command.terminalId);
        deps.emit({ kind: 'terminalClosed', terminalId: command.terminalId, exitCode });
        deps.logger.info('terminal closed', { terminalId: command.terminalId, exitCode });
      });
    },
    async input(command) {
      lookup(command.terminalId).write(command.data);
    },
    async resize(command) {
      lookup(command.terminalId).resize(command.cols, command.rows);
    },
    async close(command) {
      await lookup(command.terminalId).close();
    },
    async closeAll() {
      await Promise.allSettled([...sessions.values()].map((session) => session.close()));
    },
    get size() {
      return sessions.size;
    },
  };
}
