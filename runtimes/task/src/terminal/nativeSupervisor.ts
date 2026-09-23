import type { KnownAgentProtocol, NativeTerminalRecord, RunnerEvent, StartAgentTerminalCommand, TerminalControl, TerminalHolder, TerminalSnapshot } from '@crewstation/contracts';
import { TerminalSizeSchema, isKnownProtocol } from '@crewstation/contracts';
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
  /** 启动前 Hook 执行器：RFC-006 起每次启动都先经它（步骤可以为空），模型凭据也只从档位材料来。 */
  beforeStart: BeforeStartRunner;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
  prepare?: typeof prepareNativeTerminal;
  activityFactory?: typeof createOpencodeActivityChannel;
}

interface NativeEntry {
  record: NativeTerminalRecord;
  fingerprint: string;
  start: Promise<NativeTerminalRecord>;
  /** 工作目录确认后兑现（目录不合法时等失败记录写好）；启动命令只等到这里就回名册。 */
  accepted: Promise<void>;
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
  constructor(private readonly deps: NativeSupervisorDeps) { this.runnerId = deps.runnerId ?? Bun.randomUUIDv7(); }

  has(terminalId: string): boolean { return this.byTerminal.has(terminalId); }
  list() { return { runnerId: this.runnerId, terminals: [...this.entries.values()].map((e) => ({ ...e.record })) }; }
  get size(): number { return [...this.entries.values()].filter((e) => e.record.lifecycle === 'running' || e.record.lifecycle === 'starting').length; }

  start(command: StartAgentTerminalCommand): Promise<NativeTerminalRecord> {
    this.assertRunner(command.runnerId);
    const existing = this.entries.get(command.agentId);
    if (existing) {
      if (existing.fingerprint !== command.requestFingerprint || existing.record.terminalId !== command.terminalId) throw new RunnerCommandError('native_request_conflict', '启动标识已用于其他 CLI 配置');
      return existing.accepted.then(() => ({ ...existing.record }));
    }
    if (!this.deps.backend || this.deps.backend.kind !== 'native') throw new RunnerCommandError('pty_unavailable', '原生 CLI 需要支持窗口尺寸调整的原生 PTY');
    if (this.byTerminal.has(command.terminalId)) throw new RunnerCommandError('terminal_exists', '终端标识已使用');
    if (this.entries.size >= MAX_NATIVE_TERMINALS || this.size >= MAX_RUNNING_TERMINALS) throw new RunnerCommandError('terminal_limit', '本开发会话的 CLI 名册已满或并行进程达到上限（256 条名册／32 个运行中）');
    const record: NativeTerminalRecord = {
      agentId: command.agentId, terminalId: command.terminalId, runnerId: this.runnerId,
      compute: command.compute, profileRevision: command.profileRevision, protocol: command.launch.protocol, permission: command.permission,
      revision: 0, lifecycle: 'starting', startedAt: new Date().toISOString(), cols: command.cols, rows: command.rows,
    };
    const control = createTerminalControl((state) => this.deps.emit({ kind: 'terminalControl', terminalId: command.terminalId, runnerId: this.runnerId, control: state }));
    const entry: NativeEntry = { record, fingerprint: command.requestFingerprint, start: Promise.resolve(record), accepted: Promise.resolve(), control, screen: createTerminalScreen(command.cols, command.rows), outputSeq: 0, stopped: false };
    this.entries.set(command.agentId, entry);
    this.byTerminal.set(command.terminalId, entry);
    this.emit(entry);
    const cwd = this.deps.paths.resolveCwd(command.cwd);
    entry.start = this.launch(command, entry, cwd);
    // 启动前步骤可能要数分钟：工作目录一确认就回 starting 名册，进度经 nativeTerminal／beforeStart 事件流出。
    entry.accepted = cwd.then(() => undefined, () => entry.start.then(() => undefined));
    return entry.accepted.then(() => ({ ...entry.record }));
  }

  /** 启动的前半段：Hook 成功返回合并后的环境与托管上下文；失败或取消返回 undefined 并已写好失败记录。 */
  private async prepareEnvironment(command: StartAgentTerminalCommand, entry: NativeEntry, cwd: string): Promise<{ env: Record<string, string>; managed: ManagedRuntimeContext } | undefined> {
    try {
      const outcome = await this.deps.beforeStart.run({ agentId: command.agentId, processAttemptId: command.processAttemptId, material: command.beforeStart, workspace: cwd, mcp: command.mcp, onProgress: (execution) => {
        const running = execution.steps.find((s) => s.stepId === execution.currentStepId), failed = execution.steps.find((s) => s.state === 'failed');
        entry.record = { ...entry.record, beforeStart: { executionId: execution.executionId, state: execution.state, ...(running ? { currentStep: running.name } : {}), ...(failed ? { failedStep: failed.name } : {}) } };
        this.emit(entry);
      } });
      return { env: this.deps.launcher.baseEnv({ ...command.env, ...outcome.env, TERM: 'xterm-256color', COLUMNS: String(command.cols), LINES: String(command.rows) }), managed: { home: outcome.home, runDir: outcome.runDir, ...(outcome.configFile ? { configFile: outcome.configFile } : {}) } };
    } catch (error) {
      const failure = error instanceof BeforeStartFailure ? error : undefined;
      const cancelled = entry.stopped || failure?.code === 'cancelled';
      this.deps.beforeStart.release(command.agentId);
      entry.control.dispose();
      entry.record = { ...entry.record, lifecycle: cancelled ? 'ended' : 'failed', endedAt: new Date().toISOString(), reason: cancelled ? 'stopped' : 'before-start-failed',
        ...(cancelled ? {} : { error: `环境准备失败：${failure?.stepId ? `步骤 ${failure.stepId}，` : ''}${error instanceof Error ? error.message : String(error)}` }) };
      this.emit(entry);
      return undefined;
    }
  }

  private async launch(command: StartAgentTerminalCommand, entry: NativeEntry, cwdResolution: Promise<string>): Promise<NativeTerminalRecord> {
    try {
      const cwd = await cwdResolution;
      // 目录解析期间 stop 到达时 Hook 尚未登记，取消不到它：在这里截住，不再跑启动前步骤。
      if (entry.stopped) return this.endStopped(entry);
      const environment = await this.prepareEnvironment(command, entry, cwd);
      if (!environment) return { ...entry.record };
      if (entry.stopped) return this.endStopped(entry);
      // 通用终端协议没有 Agent 动态（RFC-006 C6）：不开观测通道，也不发 source-unavailable。
      const { protocol } = command.launch;
      entry.activity = isKnownProtocol(protocol) ? this.observe(entry, protocol) : undefined;
      const prepared = await (this.deps.prepare ?? prepareNativeTerminal)(command, { cwd, env: environment.env, host: createProcessHost(this.deps.launcher), logger: this.deps.logger, ...(entry.activity ? { nativeActivity: entry.activity.options } : {}), managed: environment.managed, runDir: environment.managed.runDir });
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
      entry.control.dispose();
      this.deps.beforeStart.release(command.agentId);
      entry.record = { ...entry.record, lifecycle: 'failed', endedAt: new Date().toISOString(), reason: 'start-failed', error: error instanceof Error ? error.message : 'CLI 启动失败' };
      this.emit(entry);
    }
    return { ...entry.record };
  }

  private endStopped(entry: NativeEntry): NativeTerminalRecord {
    this.deps.beforeStart.release(entry.record.agentId);
    entry.control.dispose();
    entry.record = { ...entry.record, lifecycle: 'ended', endedAt: new Date().toISOString(), reason: 'stopped' };
    this.emit(entry);
    return { ...entry.record };
  }

  private output(entry: NativeEntry, data: string): void {
    const terminalSeq = ++entry.outputSeq;
    void entry.screen.write(data, terminalSeq).then(() => {
      this.deps.emit({ kind: 'terminalOutput', terminalId: entry.record.terminalId, runnerId: this.runnerId, terminalSeq, data });
    }).catch((error: unknown) => this.deps.logger.error('native terminal screen write failed', { agentId: entry.record.agentId, error: String(error) }));
  }

  private observe(entry: NativeEntry, protocol: KnownAgentProtocol): NativeActivityObserver | undefined {
    try { return (this.deps.activityFactory ?? (protocol === 'claude-code' ? createClaudeActivityChannel : createOpencodeActivityChannel))({ ...entry.record, emit: (activity) => this.deps.emit({ kind: 'nativeActivity', activity }) }); }
    catch {
      this.deps.logger.warn('native activity channel unavailable; CLI remains usable', { agentId: entry.record.agentId });
      this.deps.emit({ kind: 'nativeActivity', activity: {
        agentId: entry.record.agentId, terminalId: entry.record.terminalId, runnerId: this.runnerId, eventId: Bun.randomUUIDv7(), seq: 1, turnOrdinal: 0,
        signal: { source: protocol === 'claude-code' ? 'claude-code/2.1.268' : 'opencode/1.18.29', sourceEventId: 'channel-unavailable', kind: 'source-unavailable', occurredAt: new Date().toISOString(), nativeSessionId: null, turnId: null, reason: 'source-error' },
      } });
      return undefined;
    }
  }

  private exited(entry: NativeEntry, exitCode: number | null): void {
    entry.record = { ...entry.record, lifecycle: 'ended', exitCode, endedAt: new Date().toISOString(), reason: entry.stopped ? 'stopped' : 'exited' };
    entry.prepared?.dispose();
    entry.control.dispose();
    this.deps.beforeStart.release(entry.record.agentId);
    entry.activity?.close();
    this.emit(entry);
    this.deps.emit({ kind: 'terminalClosed', terminalId: entry.record.terminalId, exitCode });
  }

  async attach(terminalId: string, runnerId: string): Promise<TerminalSnapshot> {
    this.assertRunner(runnerId);
    const entry = this.lookup(terminalId), screen = await entry.screen.snapshot();
    return { terminalId, runnerId: this.runnerId, ...screen, control: entry.control.state() };
  }

  /**
   * 启动中（进程拉起前）也可以取得（RFC-022 B7）：创建者的窗口提前取得，CLI 第一次查询终端时就有窗口回答；
   * 输入与改尺寸仍要等进程拉起。已结束或失败的 CLI 不能取得。
   */
  claim(terminalId: string, viewId: string, runnerId: string, holder?: TerminalHolder): TerminalControl {
    this.assertRunner(runnerId);
    const entry = this.lookup(terminalId);
    if (entry.record.lifecycle !== 'starting') this.assertRunning(entry);
    return entry.control.claim(viewId, holder);
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
    // 准备中的启动：取消 Hook，跳过后续步骤，不创建 CLI。
    if (entry.record.lifecycle === 'starting') this.deps.beforeStart.cancel(agentId);
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
