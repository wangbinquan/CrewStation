import type { NativeTerminalRecord, RunnerEvent, StartAgentTerminalCommand, TerminalControl, TerminalSnapshot } from '@crewstation/contracts';
import { TerminalSizeSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { ManagedRuntimeContext, PreparedNativeTerminal } from '@crewstation/agent-drivers';
import { prepareNativeTerminal } from '@crewstation/agent-drivers';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import { BeforeStartFailure } from '../beforeStart/failure';
import { createProcessHost } from '../agents/cliDriver';
import type { NativeActivityObserver } from '../activity/nativeActivityChannel';
import { createOpencodeActivityChannel } from '../activity/nativeActivityChannel';
import { createClaudeActivityChannel } from '../activity/claudeActivityChannel';
import { RunnerCommandError, notFound } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { PtyBackend, PtySession } from './ptyBackend';
import { createTerminalControl } from './terminalControl';
import { createTerminalScreen } from './terminalScreen';

export interface NativeSupervisorDeps {
  runnerId?: string;
  backend: PtyBackend | undefined;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  agentEnv: Record<string, string>;
  /** RFC-004：启动前 Hook 执行器；缺省表示本容器不支持托管启动。 */
  beforeStart?: BeforeStartRunner;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
  prepare?: typeof prepareNativeTerminal;
  activityFactory?: typeof createOpencodeActivityChannel;
}

interface NativeEntry {
  record: NativeTerminalRecord;
  fingerprint: string;
  start: Promise<NativeTerminalRecord>;
  control: ReturnType<typeof createTerminalControl>;
  screen: ReturnType<typeof createTerminalScreen>;
  outputSeq: number;
  session?: PtySession;
  prepared?: PreparedNativeTerminal;
  activity?: NativeActivityObserver;
  stopped: boolean;
}

const MAX_NATIVE_TERMINALS = 256;
const MAX_RUNNING_TERMINALS = 32;

/** 注册表的寿命等于 Runner；进程退出保留名册与有界屏幕，断开显示连接不改变进程。 */
export class NativeTerminalSupervisor {
  readonly runnerId: string;
  private readonly entries = new Map<string, NativeEntry>();
  private readonly byTerminal = new Map<string, NativeEntry>();
  constructor(private readonly deps: NativeSupervisorDeps) { this.runnerId = deps.runnerId ?? crypto.randomUUID(); }

  has(terminalId: string): boolean { return this.byTerminal.has(terminalId); }
  list() { return { runnerId: this.runnerId, terminals: [...this.entries.values()].map((e) => ({ ...e.record })) }; }
  get size(): number { return [...this.entries.values()].filter((e) => e.record.lifecycle === 'running' || e.record.lifecycle === 'starting').length; }

  start(command: StartAgentTerminalCommand): Promise<NativeTerminalRecord> {
    this.assertRunner(command.runnerId);
    const existing = this.entries.get(command.agentId);
    if (existing) {
      if (existing.fingerprint !== command.requestFingerprint || existing.record.terminalId !== command.terminalId) throw new RunnerCommandError('native_request_conflict', '启动标识已用于其他 CLI 配置');
      return existing.start.then(() => ({ ...existing.record }));
    }
    if (!this.deps.backend || this.deps.backend.kind !== 'native') throw new RunnerCommandError('pty_unavailable', '原生 CLI 需要支持窗口尺寸调整的原生 PTY');
    if (this.byTerminal.has(command.terminalId)) throw new RunnerCommandError('terminal_exists', '终端标识已使用');
    if (this.entries.size >= MAX_NATIVE_TERMINALS || this.size >= MAX_RUNNING_TERMINALS) throw new RunnerCommandError('terminal_limit', '本开发会话的 CLI 名册已满或并行进程达到上限（256 条名册／32 个运行中）');
    if (command.runtime && !this.deps.beforeStart) throw new RunnerCommandError('agent_runtime_unavailable', '本容器不支持管理员运行环境');
    const record: NativeTerminalRecord = {
      agentId: command.agentId, terminalId: command.terminalId, runnerId: this.runnerId,
      compute: command.compute, permission: command.permission, revision: 0, lifecycle: 'starting', startedAt: new Date().toISOString(), cols: command.cols, rows: command.rows,
      ...(command.runtime ? { runtime: { configId: command.runtime.configId, revision: command.runtime.revision } } : {}),
    };
    const entry: NativeEntry = { record, fingerprint: command.requestFingerprint, start: Promise.resolve(record), control: createTerminalControl(), screen: createTerminalScreen(command.cols, command.rows), outputSeq: 0, stopped: false };
    this.entries.set(command.agentId, entry);
    this.byTerminal.set(command.terminalId, entry);
    this.emit(entry);
    entry.start = this.launch(command, entry);
    // 托管启动要先跑完 Hook（可能数分钟）：立即回 starting 名册，进度经 nativeTerminal／beforeStart 事件流出。
    return command.runtime ? Promise.resolve({ ...entry.record }) : entry.start;
  }

  /** 托管启动的前半段：Hook 成功返回合并后的环境与托管上下文；失败或取消返回 undefined 并已写好失败记录。 */
  private async prepareManaged(command: StartAgentTerminalCommand, entry: NativeEntry, cwd: string): Promise<{ env: Record<string, string>; managed: ManagedRuntimeContext } | undefined> {
    try {
      const outcome = await this.deps.beforeStart!.run({ agentId: command.agentId, processAttemptId: command.processAttemptId ?? `${command.agentId}:1`, material: command.runtime!, workspace: cwd, onProgress: (execution) => {
        const running = execution.steps.find((s) => s.stepId === execution.currentStepId), failed = execution.steps.find((s) => s.state === 'failed');
        entry.record = { ...entry.record, beforeStart: { executionId: execution.executionId, state: execution.state, ...(running ? { currentStep: running.name } : {}), ...(failed ? { failedStep: failed.name } : {}) } };
        this.emit(entry);
      } });
      return { env: this.deps.launcher.baseEnv({ ...command.env, ...outcome.env, TERM: 'xterm-256color', COLUMNS: String(command.cols), LINES: String(command.rows) }), managed: { home: outcome.home, runDir: outcome.runDir, ...(outcome.configFile ? { configFile: outcome.configFile } : {}) } };
    } catch (error) {
      const failure = error instanceof BeforeStartFailure ? error : undefined;
      const cancelled = entry.stopped || failure?.code === 'cancelled';
      entry.record = { ...entry.record, lifecycle: cancelled ? 'ended' : 'failed', endedAt: new Date().toISOString(), reason: cancelled ? 'stopped' : 'before-start-failed',
        ...(cancelled ? {} : { error: `环境准备失败：${failure?.stepId ? `步骤 ${failure.stepId}，` : ''}${error instanceof Error ? error.message : String(error)}` }) };
      this.emit(entry);
      return undefined;
    }
  }

  private async launch(command: StartAgentTerminalCommand, entry: NativeEntry): Promise<NativeTerminalRecord> {
    try {
      const cwd = await this.deps.paths.resolveCwd(command.cwd);
      // 托管与部署配置模式不混合：有 runtime 材料就不读旧 agentEnv 文件。
      let env = this.deps.launcher.baseEnv({ ...this.deps.agentEnv, ...command.env, TERM: 'xterm-256color', COLUMNS: String(command.cols), LINES: String(command.rows) });
      let managed: ManagedRuntimeContext | undefined;
      if (command.runtime) {
        const prepared = await this.prepareManaged(command, entry, cwd);
        if (!prepared) return { ...entry.record };
        env = prepared.env; managed = prepared.managed;
        if (entry.stopped) { entry.record = { ...entry.record, lifecycle: 'ended', endedAt: new Date().toISOString(), reason: 'stopped' }; this.emit(entry); return { ...entry.record }; }
      }
      entry.activity = this.observe(entry, command.driver);
      const prepared = await (this.deps.prepare ?? prepareNativeTerminal)(command, { cwd, env, host: createProcessHost(this.deps.launcher), logger: this.deps.logger, ...(entry.activity ? { nativeActivity: entry.activity.options } : {}), ...(managed ? { managed, runDir: managed.runDir } : {}) });
      entry.prepared = prepared;
      if (prepared.activityUnavailable) entry.activity?.unavailable(prepared.activityUnavailable);
      const session = this.deps.backend!.open({ ...prepared.plan, cols: command.cols, rows: command.rows, onData: (data) => this.output(entry, data) });
      entry.session = session;
      entry.record = { ...entry.record, lifecycle: 'running', ...(prepared.nativeSessionId ? { nativeSessionId: prepared.nativeSessionId } : {}) };
      this.emit(entry);
      void session.exited.then((code) => this.exited(entry, code));
    } catch (error) {
      entry.activity?.close();
      entry.prepared?.dispose();
      entry.record = { ...entry.record, lifecycle: 'failed', endedAt: new Date().toISOString(), reason: 'start-failed', error: error instanceof Error ? error.message : 'CLI 启动失败' };
      this.emit(entry);
    }
    return { ...entry.record };
  }

  private output(entry: NativeEntry, data: string): void {
    const terminalSeq = ++entry.outputSeq;
    void entry.screen.write(data, terminalSeq).then(() => {
      this.deps.emit({ kind: 'terminalOutput', terminalId: entry.record.terminalId, runnerId: this.runnerId, terminalSeq, data });
    }).catch((error: unknown) => this.deps.logger.error('native terminal screen write failed', { agentId: entry.record.agentId, error: String(error) }));
  }

  private observe(entry: NativeEntry, driver: 'claude-code' | 'opencode'): NativeActivityObserver | undefined {
    try { return (this.deps.activityFactory ?? (driver === 'claude-code' ? createClaudeActivityChannel : createOpencodeActivityChannel))({ ...entry.record, emit: (activity) => this.deps.emit({ kind: 'nativeActivity', activity }) }); }
    catch {
      this.deps.logger.warn('native activity channel unavailable; CLI remains usable', { agentId: entry.record.agentId });
      this.deps.emit({ kind: 'nativeActivity', activity: {
        agentId: entry.record.agentId, terminalId: entry.record.terminalId, runnerId: this.runnerId, eventId: crypto.randomUUID(), seq: 1, turnOrdinal: 0,
        signal: { source: driver === 'claude-code' ? 'claude-code/2.1.268' : 'opencode/1.18.29', sourceEventId: 'channel-unavailable', kind: 'source-unavailable', occurredAt: new Date().toISOString(), nativeSessionId: null, turnId: null, reason: 'source-error' },
      } });
      return undefined;
    }
  }

  private exited(entry: NativeEntry, exitCode: number | null): void {
    entry.record = { ...entry.record, lifecycle: 'ended', exitCode, endedAt: new Date().toISOString(), reason: entry.stopped ? 'stopped' : 'exited' };
    entry.prepared?.dispose();
    if (entry.record.runtime) this.deps.beforeStart?.release(entry.record.agentId);
    entry.activity?.close();
    this.emit(entry);
    this.deps.emit({ kind: 'terminalClosed', terminalId: entry.record.terminalId, exitCode });
  }

  async attach(terminalId: string, runnerId: string): Promise<TerminalSnapshot> {
    this.assertRunner(runnerId);
    return { terminalId, runnerId: this.runnerId, ...await this.lookup(terminalId).screen.snapshot() };
  }

  claim(terminalId: string, viewId: string, runnerId: string): TerminalControl {
    this.assertRunner(runnerId);
    const entry = this.lookup(terminalId);
    this.assertRunning(entry);
    return entry.control.claim(viewId);
  }

  detach(terminalId: string, viewId: string): void { this.lookup(terminalId).control.release(viewId); }
  input(terminalId: string, data: string, viewId?: string): void {
    const entry = this.lookup(terminalId);
    this.assertRunning(entry);
    entry.control.assert(viewId);
    entry.session!.write(data);
  }

  async resize(terminalId: string, cols: number, rows: number, viewId?: string): Promise<void> {
    TerminalSizeSchema.parse({ cols, rows });
    const entry = this.lookup(terminalId);
    this.assertRunning(entry);
    entry.control.assert(viewId);
    const terminalSeq = ++entry.outputSeq;
    await entry.screen.resize(cols, rows, terminalSeq);
    entry.session!.resize(cols, rows);
    entry.record = { ...entry.record, cols, rows };
    this.deps.emit({ kind: 'terminalResized', terminalId, runnerId: this.runnerId, terminalSeq, cols, rows });
  }

  async stop(agentId: string, runnerId: string): Promise<void> {
    this.assertRunner(runnerId);
    const entry = this.entries.get(agentId);
    if (!entry) throw notFound(`agent ${agentId}`);
    entry.stopped = true;
    // 准备中的托管启动：取消 Hook，跳过后续步骤，不创建 CLI。
    if (entry.record.runtime && entry.record.lifecycle === 'starting') this.deps.beforeStart?.cancel(agentId);
    await entry.start;
    if (entry.record.lifecycle === 'running') await entry.session!.close();
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.entries.keys()].map((id) => this.stop(id, this.runnerId)));
    await Promise.allSettled([...this.entries.values()].map((e) => e.screen.dispose()));
  }

  private emit(entry: NativeEntry): void { entry.record = { ...entry.record, revision: entry.record.revision + 1 }; this.deps.emit({ kind: 'nativeTerminal', terminal: { ...entry.record } }); }
  private assertRunner(id: string): void {
    if (id !== this.runnerId) throw new RunnerCommandError('runner_restarted', '容器进程已更换，原 CLI 不可恢复；不会自动创建替代进程');
  }
  private assertRunning(entry: NativeEntry): void {
    if (entry.record.lifecycle !== 'running') throw new RunnerCommandError('terminal_ended', 'CLI 进程尚未运行或已经结束');
  }
  private lookup(terminalId: string): NativeEntry {
    const entry = this.byTerminal.get(terminalId);
    if (!entry) throw notFound(`terminal ${terminalId}`);
    return entry;
  }
}
