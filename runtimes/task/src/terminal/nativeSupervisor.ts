import type { NativeTerminalRecord, RunnerEvent, StartAgentTerminalCommand, TerminalControl, TerminalSnapshot } from '@crewstation/contracts';
import { TerminalSizeSchema } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { PreparedNativeTerminal } from '@crewstation/agent-drivers';
import { prepareNativeTerminal } from '@crewstation/agent-drivers';
import { createProcessHost } from '../agents/cliDriver';
import { RunnerCommandError, notFound } from '../commandError';
import type { WorkdirPaths } from '../files/workdirPath';
import type { ProcessLauncher } from '../process/launcher';
import type { PtyBackend, PtySession } from './ptyBackend';
import { createTerminalControl } from './terminalControl';
import { createTerminalScreen } from './terminalScreen';

export interface NativeSupervisorDeps {
  backend: PtyBackend | undefined;
  launcher: ProcessLauncher;
  paths: WorkdirPaths;
  agentEnv: Record<string, string>;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
  prepare?: typeof prepareNativeTerminal;
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
  stopped: boolean;
}

const MAX_NATIVE_TERMINALS = 256;
const MAX_RUNNING_TERMINALS = 32;

/** 注册表的寿命等于 Runner；进程退出保留名册与有界屏幕，断开显示连接不改变进程。 */
export class NativeTerminalSupervisor {
  readonly runnerId = crypto.randomUUID();
  private readonly entries = new Map<string, NativeEntry>();
  private readonly byTerminal = new Map<string, NativeEntry>();
  constructor(private readonly deps: NativeSupervisorDeps) {}

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
    const record: NativeTerminalRecord = {
      agentId: command.agentId, terminalId: command.terminalId, runnerId: this.runnerId,
      compute: command.compute, permission: command.permission, revision: 0, lifecycle: 'starting', startedAt: new Date().toISOString(), cols: command.cols, rows: command.rows,
    };
    const entry: NativeEntry = { record, fingerprint: command.requestFingerprint, start: Promise.resolve(record), control: createTerminalControl(), screen: createTerminalScreen(command.cols, command.rows), outputSeq: 0, stopped: false };
    this.entries.set(command.agentId, entry);
    this.byTerminal.set(command.terminalId, entry);
    this.emit(entry);
    entry.start = this.launch(command, entry);
    return entry.start;
  }

  private async launch(command: StartAgentTerminalCommand, entry: NativeEntry): Promise<NativeTerminalRecord> {
    try {
      const cwd = await this.deps.paths.resolveCwd(command.cwd);
      const env = this.deps.launcher.baseEnv({ ...this.deps.agentEnv, ...command.env, TERM: 'xterm-256color', COLUMNS: String(command.cols), LINES: String(command.rows) });
      const prepared = await (this.deps.prepare ?? prepareNativeTerminal)(command, { cwd, env, host: createProcessHost(this.deps.launcher), logger: this.deps.logger });
      entry.prepared = prepared;
      const session = this.deps.backend!.open({ ...prepared.plan, cols: command.cols, rows: command.rows, onData: (data) => this.output(entry, data) });
      entry.session = session;
      entry.record = { ...entry.record, lifecycle: 'running', ...(prepared.nativeSessionId ? { nativeSessionId: prepared.nativeSessionId } : {}) };
      this.emit(entry);
      void session.exited.then((code) => this.exited(entry, code));
    } catch (error) {
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

  private exited(entry: NativeEntry, exitCode: number | null): void {
    entry.record = { ...entry.record, lifecycle: 'ended', exitCode, endedAt: new Date().toISOString(), reason: entry.stopped ? 'stopped' : 'exited' };
    entry.prepared?.dispose();
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
    await entry.screen.resize(cols, rows);
    entry.session!.resize(cols, rows);
    entry.record = { ...entry.record, cols, rows };
  }

  async stop(agentId: string, runnerId: string): Promise<void> {
    this.assertRunner(runnerId);
    const entry = this.entries.get(agentId);
    if (!entry) throw notFound(`agent ${agentId}`);
    await entry.start;
    entry.stopped = true;
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
