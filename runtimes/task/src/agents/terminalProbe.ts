import type { ProbeTerminalCommand, ProbeTerminalResult } from '@crewstation/contracts';
import { platformMcpEndpoints, terminalMcpEnv } from '@crewstation/agent-drivers';
import type { Logger } from '@crewstation/kernel';
import { validation } from '@crewstation/kernel';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import { asBeforeStartFailure } from '../beforeStart/failure';
import { redactSecrets, sensitiveValues } from '../beforeStart/templateContext';
import { alreadyExists } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { PipedProcess, ProcessLauncher } from '../process/launcher';
import { ensureExecutable } from '../process/launcher';
import { killProcessTree, signalTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';

/** 参与正则判定的输出上限：测试命令应是 `--version` 一类的短输出，超出部分不再判定。 */
export const PROBE_MATCH_CHARS = 256 * 1024;
/** 结果里保留的输出尾部（契约上限）。 */
export const PROBE_TAIL_CHARS = 8192;
/** 进程退出后等管道读尽的上限；被孙进程占着的管道到期后杀掉残余进程组。 */
const DRAIN_GRACE_MS = 2000;
/** 同一 attempt 的重发直接拿回原结果；记住最近这么多次。 */
const REMEMBERED_ATTEMPTS = 64;

type CommandOutcome = NonNullable<ProbeTerminalResult['command']>;

export interface TerminalProbes {
  run(command: ProbeTerminalCommand): Promise<ProbeTerminalResult>;
  /** 排空时终止进行中的测试：取消启动前步骤、杀掉测试命令的进程组。 */
  cancelAll(): void;
}

export interface TerminalProbeDeps { beforeStart: BeforeStartRunner; launcher: ProcessLauncher; paths: WorkdirPaths; logger: Logger }

/**
 * 通用终端协议的档位测试（RFC-006 C11、§6.2）：先跑启动前步骤，再以 worker 身份执行管理员的测试命令，
 * 按正则判定 stdout＋stderr。通过与否由平台按「退出码 0 且匹配」裁定，这里只如实回报。
 */
export function createTerminalProbes(deps: TerminalProbeDeps): TerminalProbes {
  const byAttempt = new Map<string, Promise<ProbeTerminalResult>>();
  const active = new Map<string, AbortController>();
  return {
    async run(command) {
      const remembered = byAttempt.get(command.processAttemptId);
      if (remembered) return remembered;
      if (active.has(command.probeId)) throw alreadyExists('probe_exists', `probe ${command.probeId}`);
      const expectation = compileExpectation(command.expect);
      const abort = new AbortController();
      active.set(command.probeId, abort);
      const result = execute(deps, command, expectation, abort.signal).finally(() => active.delete(command.probeId));
      byAttempt.set(command.processAttemptId, result);
      // 失败（目录不合法等协议错误）不记住：同一 attempt 修正后可以重发。
      result.catch(() => byAttempt.delete(command.processAttemptId));
      for (const key of byAttempt.keys()) { if (byAttempt.size <= REMEMBERED_ATTEMPTS) break; byAttempt.delete(key); }
      return result;
    },
    cancelAll() {
      for (const [probeId, abort] of active) { abort.abort(); deps.beforeStart.cancel(probeId); }
    },
  };
}

function compileExpectation(source: string): RegExp {
  try { return new RegExp(source); }
  catch (error) { throw validation(`期望输出不是合法的正则：${error instanceof Error ? error.message : String(error)}`, { field: 'expect' }); }
}

async function execute(deps: TerminalProbeDeps, command: ProbeTerminalCommand, expectation: RegExp, signal: AbortSignal): Promise<ProbeTerminalResult> {
  const cwd = await deps.paths.resolveCwd(command.cwd);
  let outcome;
  try {
    outcome = await deps.beforeStart.run({ agentId: command.probeId, processAttemptId: command.processAttemptId, material: command.beforeStart, workspace: cwd, mcp: command.mcp });
  } catch (error) {
    deps.beforeStart.release(command.probeId);
    const failure = asBeforeStartFailure(error);
    return { probeId: command.probeId, beforeStart: { state: failure.code === 'cancelled' ? 'cancelled' : 'failed', error: failure.toError() } };
  }
  try {
    // 与「＋ CLI」同一份环境：档位材料的变量与凭据、命令追加的变量；通用终端再加 CS_MCP_*（C16）。
    const env = deps.launcher.baseEnv({ ...command.env, ...outcome.env, ...(command.launch.protocol === 'terminal' ? terminalMcpEnv(command.mcp) : {}) });
    const sensitive = sensitiveValues({ secrets: command.beforeStart.secrets, mcp: platformMcpEndpoints(command.mcp) });
    const result = await runCommand(deps.launcher, command, { cwd, env, expectation, sensitive, signal });
    deps.logger.info('terminal probe finished', { probeId: command.probeId, profile: `${command.compute}@${command.profileRevision}`, exitCode: result.exitCode, timedOut: result.timedOut, matched: result.matched, durationMs: result.durationMs, spawnFailed: result.spawnError !== undefined });
    return { probeId: command.probeId, beforeStart: { state: 'succeeded' }, command: result };
  } finally {
    deps.beforeStart.release(command.probeId);
  }
}

interface CommandContext { cwd: string; env: Record<string, string>; expectation: RegExp; sensitive: string[]; signal: AbortSignal }

async function runCommand(launcher: ProcessLauncher, command: ProbeTerminalCommand, context: CommandContext): Promise<CommandOutcome> {
  const startedAt = Date.now();
  const notStarted = (message: string): CommandOutcome => ({ exitCode: null, timedOut: false, matched: false, outputTail: '', durationMs: Date.now() - startedAt, spawnError: redactSecrets(message, context.sensitive) });
  // 测试命令可以不经档位的二进制（例如 sh -c）；档位二进制本身不在，「＋ CLI」必然起不来，先判掉。
  try { ensureExecutable([command.launch.binaryPath], context.cwd, context.env); } catch { return notStarted(`档位二进制 ${command.launch.binaryPath} 不存在或不可执行`); }
  if (context.signal.aborted) return notStarted('测试在命令开始前被取消');
  let proc: PipedProcess;
  try { proc = launcher.spawnPiped({ cmd: command.command, cwd: context.cwd, env: context.env }); }
  catch (error) { return notStarted(`无法启动测试命令：${error instanceof Error ? error.message : String(error)}`); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void killProcessTree(proc); }, command.timeoutMs);
  const onAbort = (): void => void killProcessTree(proc);
  context.signal.addEventListener('abort', onAbort, { once: true });
  const output = createProbeOutput();
  const pumps = Promise.all([pumpStream(proc.stdout, output.push), pumpStream(proc.stderr, output.push)]);
  try {
    await proc.exited;
    const drained = await Promise.race([pumps.then(() => true), Bun.sleep(DRAIN_GRACE_MS).then(() => false)]);
    if (!drained) signalTree(proc, 'SIGKILL');
  } finally {
    clearTimeout(timer);
    context.signal.removeEventListener('abort', onAbort);
  }
  // 超时是整个进程组被终止：退出码一律为空。进程组收到 SIGTERM 时 shell 可能先看到子进程被杀、自己以 143 退出，负载下时有时无（与启动前脚本一致，超时优先）。
  return {
    exitCode: timedOut ? null : proc.exitCode, timedOut, matched: context.expectation.test(output.head()),
    outputTail: redactSecrets(output.tail(), context.sensitive).slice(-PROBE_TAIL_CHARS), durationMs: Date.now() - startedAt,
  };
}

/** 两条流按到达顺序合并：开头 PROBE_MATCH_CHARS 字符供判定，末尾两倍窗口先脱敏再截成契约上限（凭据跨窗口边界也遮得住）。 */
function createProbeOutput(): { push: (text: string) => void; head: () => string; tail: () => string } {
  let head = '', tail = '';
  return {
    push: (text) => {
      if (head.length < PROBE_MATCH_CHARS) head += text.slice(0, PROBE_MATCH_CHARS - head.length);
      tail = (tail + text).slice(-PROBE_TAIL_CHARS * 2);
    },
    head: () => head,
    tail: () => tail,
  };
}
