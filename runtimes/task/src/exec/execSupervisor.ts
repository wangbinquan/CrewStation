import type { RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError, alreadyExists, notFound } from '../commandError';
import type { CommandOf } from '../commandDispatcher';
import type { WorkdirPaths } from '../files/workdirPath';
import type { PipedProcess, ProcessLauncher } from '../process/launcher';
import { killProcessTree, signalTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';

/** 进程退出后等待管道读尽的上限；仍被孙进程占着的管道到期后放弃并杀掉残余进程组。 */
const DRAIN_GRACE_MS = 2000;
/** wait=true 时 stdout／stderr 各自保留的上限（协议：256 KiB，超出即 truncated）。 */
export const MAX_WAIT_OUTPUT_BYTES = 256 * 1024;

export interface ExecResultPayload {
  execId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
}

export interface ExecSupervisor {
  /** wait=false：拉起后立即返回 `{}`，输出走 execOutput／execExited 事件；wait=true：到进程结束（或超时）才返回汇总结果，只发 execExited。 */
  run(command: CommandOf<'exec'>): Promise<Record<string, never> | ExecResultPayload>;
  cancel(execId: string): Promise<void>;
  cancelAll(): Promise<void>;
  readonly size: number;
}

export interface ExecSupervisorDeps {
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
}

interface RunningExec {
  proc: PipedProcess;
  timer: ReturnType<typeof setTimeout>;
  timedOut: boolean;
}

interface OutputCollector {
  text: string;
  bytes: number;
  truncated: boolean;
}

type ExecStream = 'stdout' | 'stderr';

/** exec：以 worker 身份在工作目录内运行一条命令；超时或取消时杀整棵进程树。 */
export function createExecSupervisor(deps: ExecSupervisorDeps): ExecSupervisor {
  const running = new Map<string, RunningExec>();
  const finish = async (execId: string, entry: RunningExec, startedAt: number, pumps: Promise<unknown>): Promise<{ exitCode: number | null; durationMs: number }> => {
    await entry.proc.exited;
    const drained = await Promise.race([pumps.then(() => true), Bun.sleep(DRAIN_GRACE_MS).then(() => false)]);
    if (!drained) signalTree(entry.proc, 'SIGKILL');
    clearTimeout(entry.timer);
    running.delete(execId);
    const exitCode = entry.proc.exitCode;
    const durationMs = Date.now() - startedAt;
    deps.emit({ kind: 'execExited', execId, exitCode, durationMs });
    deps.logger.info('exec exited', { execId, exitCode, signal: entry.proc.signalCode, timedOut: entry.timedOut, drained, durationMs });
    return { exitCode, durationMs };
  };
  const launch = async (command: CommandOf<'exec'>): Promise<{ entry: RunningExec; startedAt: number }> => {
    if (running.has(command.execId)) throw alreadyExists('exec_exists', `exec ${command.execId}`);
    const cwd = await deps.paths.resolveCwd(command.cwd);
    const env = deps.launcher.baseEnv(command.env);
    const startedAt = Date.now();
    const proc = spawnOrThrow(() => deps.launcher.spawnPiped({ cmd: command.command, cwd, env }));
    const entry: RunningExec = {
      proc,
      timedOut: false,
      timer: setTimeout(() => {
        entry.timedOut = true;
        deps.logger.warn('exec timed out', { execId: command.execId, timeoutSeconds: command.timeoutSeconds });
        void killProcessTree(proc);
      }, command.timeoutSeconds * 1000),
    };
    running.set(command.execId, entry);
    deps.logger.info('exec started', { execId: command.execId, argv0: command.command[0], pid: proc.pid, wait: command.wait });
    return { entry, startedAt };
  };
  return {
    async run(command): Promise<Record<string, never> | ExecResultPayload> {
      const { entry, startedAt } = await launch(command);
      const collectors = command.wait ? { stdout: newCollector(), stderr: newCollector() } : undefined;
      const sink = (stream: ExecStream) => (data: string): void => {
        if (collectors) appendBounded(collectors[stream], data, MAX_WAIT_OUTPUT_BYTES);
        else deps.emit({ kind: 'execOutput', execId: command.execId, stream, data });
      };
      const pumps = Promise.all([pumpStream(entry.proc.stdout, sink('stdout')), pumpStream(entry.proc.stderr, sink('stderr'))]);
      const done = finish(command.execId, entry, startedAt, pumps);
      if (!collectors) {
        void done;
        return {};
      }
      const { exitCode, durationMs } = await done;
      return { execId: command.execId, exitCode, stdout: collectors.stdout.text, stderr: collectors.stderr.text, durationMs, truncated: collectors.stdout.truncated || collectors.stderr.truncated };
    },
    async cancel(execId) {
      const entry = running.get(execId);
      if (!entry) throw notFound(`exec ${execId}`);
      await killProcessTree(entry.proc);
    },
    async cancelAll() {
      await Promise.allSettled([...running.values()].map((entry) => killProcessTree(entry.proc)));
    },
    get size() {
      return running.size;
    },
  };
}

function newCollector(): OutputCollector {
  return { text: '', bytes: 0, truncated: false };
}

/** 按字节上限累加文本；越界时在字节边界截断并去掉可能被切开的多字节字符。 */
export function appendBounded(collector: OutputCollector, chunk: string, maxBytes: number): void {
  if (collector.truncated) return;
  const chunkBytes = Buffer.byteLength(chunk, 'utf8');
  if (collector.bytes + chunkBytes <= maxBytes) {
    collector.text += chunk;
    collector.bytes += chunkBytes;
    return;
  }
  const room = maxBytes - collector.bytes;
  collector.text += Buffer.from(chunk, 'utf8').subarray(0, room).toString('utf8').replace(/�+$/, '');
  collector.bytes = maxBytes;
  collector.truncated = true;
}

function spawnOrThrow<T>(spawn: () => T): T {
  try {
    return spawn();
  } catch (error) {
    throw new RunnerCommandError('spawn_failed', error instanceof Error ? error.message : String(error));
  }
}
