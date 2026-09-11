import type { PreviewState, RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import { RunnerCommandError } from '../commandError';
import type { PreviewConfig, RunnerConfig } from '../config';
import type { PipedProcess, ProcessLauncher } from '../process/launcher';
import { isAlive, killProcessTree } from '../process/processTree';
import { createLineSplitter, pumpStream } from '../process/streamPump';

export interface PreviewStatusPayload {
  state: PreviewState;
  port?: number;
  restarts: number;
  lastError?: string;
}

export interface PreviewSupervisor {
  start(): void;
  restart(): Promise<void>;
  stop(): Promise<void>;
  status(): PreviewStatusPayload;
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
}

export function createPreviewSupervisor(deps: PreviewSupervisorDeps): PreviewSupervisor {
  return new ProcessPreviewSupervisor(deps);
}

/**
 * 预览进程监督：启动 → 轮询健康路径至 2xx 记 ready；意外退出按指数退避重启，超过上限记 crashed；
 * restartPreview 清零计数重来。每次状态迁移都发 previewState 事件。
 */
class ProcessPreviewSupervisor implements PreviewSupervisor {
  private state: PreviewState;
  private restarts = 0;
  private lastError: string | undefined;
  private proc: PipedProcess | undefined;
  private generation = 0;
  private stopping = false;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly deps: PreviewSupervisorDeps) {
    this.state = deps.config ? 'stopped' : 'disabled';
    this.fetchImpl = deps.fetchImpl ?? fetch;
  }

  get enabled(): boolean {
    return this.deps.config !== undefined;
  }

  start(): void {
    if (!this.deps.config || this.proc) return;
    this.stopping = false;
    this.launch();
  }

  async restart(): Promise<void> {
    if (!this.deps.config) throw new RunnerCommandError('preview_disabled', '本任务没有配置预览命令');
    this.stopping = false;
    this.restarts = 0;
    this.lastError = undefined;
    await this.terminateCurrent();
    this.launch();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.terminateCurrent();
    if (this.state !== 'disabled') this.transition('stopped');
  }

  status(): PreviewStatusPayload {
    return { state: this.state, port: this.deps.config?.port, restarts: this.restarts, lastError: this.lastError };
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
    this.transition('starting', `attempt ${this.restarts + 1}`);
    this.forwardOutput(proc);
    void this.pollUntilReady(generation, proc);
    void proc.exited.then(() => this.onExit(generation, proc));
  }

  private forwardOutput(proc: PipedProcess): void {
    const log = (stream: 'stdout' | 'stderr') => createLineSplitter((line) => this.deps.logger.info('preview output', { stream, line }));
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
