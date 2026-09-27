import { createHash } from 'node:crypto';
import { BusinessCommandEnvironmentSchema, businessCommandDigestInput } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { PipedProcess, ProcessLauncher } from '../process/launcher';
import { killProcessTree, signalTree } from '../process/processTree';
import { pumpStream } from '../process/streamPump';
import type { ExecutionIdentity, ExecutionJournal, ExecutionReceipt, ExecutionResult } from './executionJournal';

export interface BusinessExecInput extends ExecutionIdentity {
  command: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutSeconds: number;
}
interface ActiveExecution {
  proc: PipedProcess;
  startedAt: number;
  reason?: ExecutionResult['reason'];
  timer?: ReturnType<typeof setTimeout>;
  done?: Promise<void>;
}
export interface BusinessExecDeps { journal: ExecutionJournal; launcher: ProcessLauncher; paths: WorkdirPaths; logger: Logger }

/** 摘要只用于匹配同一执行的参数；落盘仅保存摘要，不保存业务 env 的值。 */
export function businessExecDigest(input: Omit<BusinessExecInput, keyof ExecutionIdentity>): string {
  return createHash('sha256').update(businessCommandDigestInput(input)).digest('hex');
}

/** v3 命令不等待退出回 RPC；完成条件仅来自持久执行日志。 */
export class BusinessExecSupervisor {
  private readonly active = new Map<string, ActiveExecution>();
  private readonly starting = new Map<string, Promise<ExecutionReceipt>>();

  constructor(private readonly deps: BusinessExecDeps) {}

  async start(input: BusinessExecInput): Promise<ExecutionReceipt> {
    if (businessExecDigest(input) !== input.payloadDigest) throw new RunnerCommandError('execution_conflict', '执行参数摘要不匹配');
    if (!input.command.length || input.command.some((part) => typeof part !== 'string' || part.includes('\0')) || !input.command[0]
      || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 86400) throw new RunnerCommandError('invalid_execution', '命令或超时参数无效');
    if (!BusinessCommandEnvironmentSchema.safeParse(input.env).success) throw new RunnerCommandError('invalid_configuration', '业务命令环境包含保留变量或非法值');
    // reserve 是同步持久事务；路径解析等异步操作之前先取得唯一 spawn 权。
    const reserved = this.deps.journal.reserve(input);
    if (!reserved.created) return this.starting.get(input.executionId) ?? reserved.receipt;
    const pending = this.launch(input);
    this.starting.set(input.executionId, pending);
    try { return await pending; }
    finally { this.starting.delete(input.executionId); }
  }

  /** Cancellation can win before a delayed start RPC; its durable tombstone prevents that RPC spawning. */
  async cancelRegistered(identity: ExecutionIdentity): Promise<ExecutionReceipt> {
    const reserved = this.deps.journal.reserve(identity);
    if (reserved.created) return this.deps.journal.finish(identity.executionId, { reason: 'cancelled', exitCode: null, durationMs: 0 });
    return this.cancel(identity.executionId);
  }

  async cancel(executionId: string): Promise<ExecutionReceipt> {
    await this.starting.get(executionId);
    const receipt = this.required(executionId);
    if (receipt.phase === 'finished') return receipt;
    const entry = this.active.get(executionId);
    if (!entry) throw new RunnerCommandError('execution_unknown', '当前 Runner 无法证明原执行的进程状态');
    // 已退出的进程让正常收尾决定结果，迟到取消不覆盖成功。
    if (entry.proc.exitCode !== null || entry.proc.signalCode !== null) { await entry.done; return this.required(executionId); }
    this.deps.journal.state(executionId, 'cancelling');
    entry.reason ??= 'cancelled';
    await killProcessTree(entry.proc);
    // killProcessTree 的有界等待可能到期；此时保持 cancelling，不伪称停止。
    if (entry.proc.exitCode !== null || entry.proc.signalCode !== null) await entry.done;
    return this.required(executionId);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.starting.values()]);
    await Promise.allSettled([...this.active.keys()].map((id) => this.cancel(id)));
    await Promise.allSettled([...this.active.values()].map((entry) => entry.done));
  }

  /** 用于 Runner 排空与用例；产品状态查询只读 journal。 */
  async settled(executionId: string): Promise<ExecutionReceipt> {
    await this.starting.get(executionId);
    await this.active.get(executionId)?.done;
    return this.required(executionId);
  }

  private required(id: string): ExecutionReceipt {
    const receipt = this.deps.journal.get(id);
    if (!receipt) throw new RunnerCommandError('execution_not_found', '执行记录不存在');
    return receipt;
  }

  private async launch(input: BusinessExecInput): Promise<ExecutionReceipt> {
    let proc: PipedProcess;
    try {
      const cwd = await this.deps.paths.resolveCwd(input.cwd);
      proc = this.deps.launcher.spawnPiped({ cmd: input.command, cwd, env: this.deps.launcher.baseEnv(input.env) });
    } catch {
      // 此分支已证明没有成功返回的进程；spawn 后的日志故障绝不能走这里。
      return this.deps.journal.finish(input.executionId, { reason: 'spawn_failed', exitCode: null, durationMs: 0 });
    }
    const entry: ActiveExecution = { proc, startedAt: Date.now() };
    this.active.set(input.executionId, entry);
    try { this.deps.journal.state(input.executionId, 'running'); }
    catch { this.storageFailure(input.executionId, entry); }
    entry.timer = setTimeout(() => {
      entry.reason ??= 'timeout';
      void killProcessTree(proc);
    }, input.timeoutSeconds * 1000);
    entry.done = this.collect(input.executionId, entry).catch(() => {
      // 日志不可写时保留未确认记录；后续 incarnation 看到 unknown，不重启副作用。
      this.deps.logger.error('business execution result could not be persisted', { executionId: input.executionId });
    }).finally(() => { clearTimeout(entry.timer); this.active.delete(input.executionId); });
    return this.required(input.executionId);
  }

  private storageFailure(id: string, entry: ActiveExecution, error?: unknown): void {
    entry.reason ??= error instanceof RunnerCommandError && error.code === 'output_limit' ? 'output_limit' : 'event_persistence_failed';
    // 输出持续涌入时不再排队占用内存；停止进程，结果明确标失败而不是完整输出。
    signalTree(entry.proc, 'SIGKILL');
    this.deps.logger.warn('business execution output stopped', { executionId: id, reason: entry.reason });
  }

  private async collect(id: string, entry: ActiveExecution): Promise<void> {
    const sink = (stream: 'stdout' | 'stderr') => (text: string) => {
      if (entry.reason === 'output_limit' || entry.reason === 'event_persistence_failed') return;
      try { this.deps.journal.output(id, stream, text); }
      catch (error) { this.storageFailure(id, entry, error); }
    };
    const pumps = Promise.all([pumpStream(entry.proc.stdout, sink('stdout')), pumpStream(entry.proc.stderr, sink('stderr'))])
      .then(() => true, () => { this.storageFailure(id, entry); return false; });
    await entry.proc.exited;
    // 主进程退出后仍持有管道的后代不能让结果提前完整；杀残余组并等管道闭合。
    const timer = setTimeout(() => { signalTree(entry.proc, 'SIGKILL'); }, 2000);
    const drained = await pumps;
    clearTimeout(timer);
    this.deps.journal.finish(id, { exitCode: entry.proc.exitCode, reason: entry.reason ?? (drained ? 'exited' : 'event_persistence_failed'), durationMs: Date.now() - entry.startedAt });
  }
}
