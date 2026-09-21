import type { PreviewLogsPayload, PreviewState, RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import type { PreviewConfig, RunnerConfig } from '../config';
import type { PipedProcess, ProcessLauncher } from '../process/launcher';
import { isAlive, killProcessTree } from '../process/processTree';
import { createLineSplitter, pumpStream } from '../process/streamPump';
import type { PreviewOutputBuffer } from './previewOutputBuffer';
import { createPreviewOutputBuffer } from './previewOutputBuffer';

export interface PreviewStatusPayload {
  state: PreviewState;
  port?: number;
  restarts: number;
  lastError?: string;
}

export interface PreviewLogQuery {
  limit: number;
  stream?: 'stdout' | 'stderr';
}

export interface PreviewSupervisor {
  /** 容器启动时的自动拉起：未配置预览或已经在跑都静默返回。 */
  start(): void;
  /** `startPreview` 命令（RFC-016）：未配置报 `preview_disabled`，已在跑报 `preview_already_running`。 */
  requestStart(): void;
  restart(): Promise<void>;
  /** `stopPreview` 命令（RFC-016）：未配置报 `preview_disabled`；停止后不自动拉起。 */
  requestStop(): Promise<void>;
  /** 排空时停掉预览；不校验配置，也不报错。 */
  stop(): Promise<void>;
  status(): PreviewStatusPayload;
  logs(query: PreviewLogQuery): PreviewLogsPayload;
  readonly enabled: boolean;
}

export interface PreviewSupervisorDeps {
  config: PreviewConfig | undefined;
  policy: RunnerConfig['previewPolicy'];
  launcher: ProcessLauncher;
  workdir: string;
  emit: (event: RunnerEvent) => void;
  logger: Logger;
  fetchImpl?: typeof fetch;
  buffer?: PreviewOutputBuffer;
}

export function createPreviewSupervisor(deps: PreviewSupervisorDeps): PreviewSupervisor {
  return new ProcessPreviewSupervisor(deps);
}

/**
 * 预览进程监督：启动 → 轮询健康路径至 2xx 记 ready；意外退出按指数退避重启，超过上限记 crashed；
 * restartPreview 清零计数重来。每次状态迁移都发 previewState 事件。
 *
 * RFC-016 另加显式停止与启动：`stopPreview` 后**不自动拉起**（`stopping` 挡住 `onExit` 的重试），
 * 端口因此腾给开发者自己在终端里跑；`startPreview` 再把它拉回来。
 */
class ProcessPreviewSupervisor implements PreviewSupervisor {
  private state: PreviewState;
  /** 退避计数：`restart`／`start` 会清零，决定还能自动重试几次。 */
  private restarts = 0;
  /**
   * 运行序号：每次真正拉起进程加一，**永不清零**。
   * 不能复用 `restarts`——显式重启会把它清零，那样重启前后的输出行都标 1，
   * 缓冲跨重启保留就白做了（Agent 正是要靠它分辨崩溃前那一次的输出）。
   */
  private runs = 0;
  private lastError: string | undefined;
  private proc: PipedProcess | undefined;
  private generation = 0;
  private stopping = false;
  private readonly fetchImpl: typeof fetch;
  private readonly buffer: PreviewOutputBuffer;

  constructor(private readonly deps: PreviewSupervisorDeps) {
    this.state = deps.config ? 'stopped' : 'disabled';
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.buffer = deps.buffer ?? createPreviewOutputBuffer();
  }

  get enabled(): boolean {
    return this.deps.config !== undefined;
  }

  start(): void {
    if (!this.deps.config || this.proc) return;
    this.stopping = false;
    this.launch();
  }

  requestStart(): void {
    this.requireConfigured();
    // 退避等待期间 proc 为空：此时重新拉起是合理的，旧的延迟 launch 会因 generation 变化而作废。
    if (this.proc) throw new RunnerCommandError('preview_already_running', '预览进程已经在运行；要重来请用重启');
    this.stopping = false;
    this.resetCounters();
    this.launch();
  }

  async restart(): Promise<void> {
    this.requireConfigured();
    this.stopping = false;
    this.resetCounters();
    await this.terminateCurrent();
    this.launch();
  }

  async requestStop(): Promise<void> {
    this.requireConfigured();
    await this.stop();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.terminateCurrent();
    if (this.state !== 'disabled') this.transition('stopped');
  }

  status(): PreviewStatusPayload {
    return { state: this.state, port: this.deps.config?.port, restarts: this.restarts, lastError: this.lastError };
  }

  /** 输出缓冲跨重启保留，`attempt` 给出最近一次运行的序号，与行上的 attempt 同源。 */
  logs(query: PreviewLogQuery): PreviewLogsPayload {
    return { ...this.buffer.read(query), attempt: this.attempt };
  }

  /** 还没拉起过时报 1：契约要求 ≥1，且此刻「下一次运行」确实是第一次。 */
  private get attempt(): number {
    return Math.max(this.runs, 1);
  }

  private requireConfigured(): void {
    if (!this.deps.config) throw new RunnerCommandError('preview_disabled', '本任务没有配置预览命令');
  }

  private resetCounters(): void {
    this.restarts = 0;
    this.lastError = undefined;
  }

  private launch(): void {
    const config = this.deps.config;
    if (!config) return;
    this.generation += 1;
    const generation = this.generation;
    const env = this.deps.launcher.baseEnv({ PORT: String(config.port) });
    let proc: PipedProcess;
    try {
      proc = this.deps.launcher.spawnPiped({ cmd: config.command, cwd: this.deps.workdir, env });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.transition('crashed', this.lastError);
      return;
    }
    this.proc = proc;
    this.runs += 1;
    this.transition('starting', `run ${this.runs}`);
    this.forwardOutput(proc, this.runs);
    void this.pollUntilReady(generation, proc);
    void proc.exited.then(() => this.onExit(generation, proc));
  }

  /** 行分割一次，两处消费：Pod 日志（原有行为不变）与 RFC-016 的输出缓冲。 */
  private forwardOutput(proc: PipedProcess, attempt: number): void {
    const log = (stream: 'stdout' | 'stderr') => createLineSplitter((line) => {
      this.deps.logger.info('preview output', { stream, line });
      this.buffer.push(stream, line, attempt);
    });
    const out = log('stdout');
    const err = log('stderr');
    void pumpStream(proc.stdout, (text) => out.push(text)).finally(() => out.flush());
    void pumpStream(proc.stderr, (text) => err.push(text)).finally(() => err.flush());
  }

  private async pollUntilReady(generation: number, proc: PipedProcess): Promise<void> {
    const config = this.deps.config;
    if (!config) return;
    const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
    while (generation === this.generation && isAlive(proc)) {
      if (await this.probe(url)) {
        if (generation === this.generation) this.transition('ready');
        return;
      }
      await Bun.sleep(this.deps.policy.pollIntervalMs);
    }
  }

  private async probe(url: string): Promise<boolean> {
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.deps.policy.probeTimeoutMs), redirect: 'manual' });
      await response.body?.cancel().catch(() => undefined);
      return response.status >= 200 && response.status < 300;
    } catch {
      return false;
    }
  }

  private async onExit(generation: number, proc: PipedProcess): Promise<void> {
    if (generation !== this.generation) return;
    this.proc = undefined;
    this.lastError = proc.signalCode ? `terminated by ${proc.signalCode}` : `exited with code ${proc.exitCode}`;
    if (this.stopping) return;
    if (this.restarts >= this.deps.policy.maxRestarts) {
      this.transition('crashed', this.lastError);
      return;
    }
    this.restarts += 1;
    const delayMs = Math.min(this.deps.policy.baseDelayMs * 2 ** (this.restarts - 1), 30_000);
    this.deps.logger.warn('preview exited, restarting', { restarts: this.restarts, delayMs, lastError: this.lastError });
    await Bun.sleep(delayMs);
    if (generation === this.generation && !this.stopping) this.launch();
  }

  private async terminateCurrent(): Promise<void> {
    const current = this.proc;
    this.generation += 1;
    this.proc = undefined;
    if (current) await killProcessTree(current);
  }

  private transition(state: PreviewState, message?: string): void {
    this.state = state;
    this.deps.emit({ kind: 'previewState', state, port: this.deps.config?.port, message });
    this.deps.logger.info('preview state', { state, message });
  }
}
