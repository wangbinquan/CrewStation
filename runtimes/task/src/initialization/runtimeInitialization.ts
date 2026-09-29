import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunnerCommand, RuntimeInitializationMaterial, RuntimeInitializationStatus } from '@crewstation/contracts';
import { RuntimeInitializationMaterialSchema } from '@crewstation/contracts';
import { RunnerCommandError } from '../commandError';
import type { ProcessLauncher } from '../process/launcher';
import { InitializationJournal } from './journal';
import { redactInitializationOutput, runInitializationCommand, toolMatches } from './process';

export interface RuntimeInitializationConfig {
  readonly material: RuntimeInitializationMaterial;
  /** Pod UID + PID 1 启动时间：重连不变，新容器变化。 */
  readonly containerIdentity: string;
  readonly journalDir: string;
}
const passiveCommands = new Set(['runtimeInitializationStatus', 'cancelRuntimeInitialization', 'shutdown', 'developmentUsageInfo', 'readDevelopmentUsageEvents', 'ackDevelopmentUsageEvents']);

export class RuntimeInitialization {
  private readonly journal?: InitializationJournal;
  private state: RuntimeInitializationStatus;
  private running?: Promise<RuntimeInitializationStatus>;
  private readonly toolChecks = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  private closed = false;

  constructor(private readonly config: RuntimeInitializationConfig | undefined, private readonly launcher: ProcessLauncher) {
    this.state = { enabled: !!config, state: config ? 'waiting' : 'succeeded', steps: [], checks: [] };
    if (!config) return;
    RuntimeInitializationMaterialSchema.parse(config.material);
    if (!config.containerIdentity) throw new RunnerCommandError('initialization_identity_missing', '初始化缺少容器身份');
    const { environmentId, startGeneration, versionId, initializerDigest } = config.material;
    const executionId = new Bun.CryptoHasher('sha256').update(`${environmentId}/${startGeneration}/${config.containerIdentity}/${versionId}/${initializerDigest}`).digest('hex');
    this.state = { ...this.state, executionId, versionId, containerIdentity: config.containerIdentity };
    this.journal = new InitializationJournal(config.journalDir);
    const reserved = this.journal.reserve(this.state);
    this.state = reserved.state;
    if (!reserved.created && ['waiting', 'running'].includes(this.state.state)) this.save({ ...this.state, state: 'unknown', error: '上次初始化结果无法确认，不会自动重执行；请重建容器' });
  }
  status(): RuntimeInitializationStatus { return structuredClone(this.state); }
  assertReady(type: string): void {
    if (this.state.state !== 'succeeded' && !passiveCommands.has(type)) throw new RunnerCommandError('runtime_initialization_not_ready', `运行环境初始化尚未成功（${this.state.state}）`);
  }
  assertCommand(command: RunnerCommand): void {
    this.assertReady(command.type);
    const env = 'env' in command ? command.env : {};
    const profile = 'beforeStart' in command ? { ...command.beforeStart.vars, ...command.beforeStart.secrets } : {};
    for (const key of Object.keys(this.config?.material.initializer.env ?? {})) {
      if ((env && key in env) || key in profile) throw new RunnerCommandError('runtime_environment_conflict', `执行配置不能覆盖镜像初始化变量 ${key}`);
    }
  }
  /** 各类 Agent／CLI 共用 beforeStart 的尾部钩子：步骤完成后检查工具，通过后才生成主进程。 */
  async checkAgentTools(processAttemptId: string, env: Record<string, string>, signal: AbortSignal): Promise<void> {
    if (this.closed || this.abort.signal.aborted) throw new RunnerCommandError('cancelled', '运行环境正在关闭');
    const pending = this.runAgentTools(processAttemptId, env, signal).finally(() => { this.toolChecks.delete(pending); });
    this.toolChecks.add(pending);
    return pending;
  }
  private async runAgentTools(processAttemptId: string, env: Record<string, string>, signal: AbortSignal): Promise<void> {
    if (!this.config) return;
    this.assertReady('startAgent');
    const material = this.config.material;
    for (const key of Object.keys(material.initializer.env)) if (key in env) throw new RunnerCommandError('runtime_environment_conflict', `档位输出不能覆盖镜像变量 ${key}`);
    if (material.toolsPhase !== 'agent-before-start' || !material.tools.length) return;
    const executionId = new Bun.CryptoHasher('sha256').update(`${this.state.executionId}/tools/${processAttemptId}`).digest('hex');
    const record = this.journal!.reserve({ ...this.state, executionId, state: 'running', checks: [] });
    if (!record.created) {
      if (record.state.state === 'succeeded') return;
      throw new RunnerCommandError('runtime_tool_check_unknown', '该次 Agent 工具检查未成功，不会重复执行，请重建容器');
    }
    const checks: RuntimeInitializationStatus['checks'] = [];
    try {
      const combined = AbortSignal.any([signal, this.abort.signal]);
      for (const check of material.tools) {
        const result = await runInitializationCommand(this.launcher, { ...check, env }, combined);
        const passed = !result.failed && toolMatches(result.output, check.expected);
        checks.push({ key: check.key, passed, exitCode: result.exitCode, output: redactInitializationOutput(result.output, { ...this.launcher.baseEnv(env), ...material.secrets }) });
        this.journal!.write({ ...record.state, checks });
        if (!passed) throw new RunnerCommandError('runtime_tool_check_failed', `运行镜像工具检查 ${check.key} 未通过`);
      }
      combined.throwIfAborted();
      this.journal!.write({ ...record.state, checks, state: 'succeeded' });
      this.save({ ...this.state, checks });
    } catch (error) {
      this.journal!.write({ ...record.state, checks, state: signal.aborted || this.abort.signal.aborted ? 'cancelled' : 'failed' });
      this.save({ ...this.state, checks });
      throw error;
    }
  }
  start(): Promise<RuntimeInitializationStatus> {
    if (this.running) return this.running;
    if (!this.config || this.state.state !== 'waiting' || this.closed) return Promise.resolve(this.status());
    this.running = this.execute(); return this.running;
  }
  async cancel(): Promise<RuntimeInitializationStatus> {
    this.abort.abort();
    if (this.state.state === 'waiting') this.save({ ...this.state, state: 'cancelled' });
    if (this.running) await this.running;
    await Promise.allSettled([...this.toolChecks]);
    return this.status();
  }
  async close(): Promise<void> { if (this.closed) return; await this.cancel(); this.closed = true; this.journal?.close(); }
  private save(state: RuntimeInitializationStatus): void { this.journal?.write(state); this.state = state; }

  private async execute(): Promise<RuntimeInitializationStatus> {
    const material = this.config!.material;
    let secretDirectory: string | undefined;
    let completed = false;
    try {
      this.save({ ...this.state, state: 'running' });
      secretDirectory = await this.prepareSecrets(material.secrets);
      const env = { ...material.initializer.env, CS_RUNTIME_SECRET_DIR: secretDirectory };
      for (const step of material.initializer.steps) {
        this.abort.signal.throwIfAborted();
        this.save({ ...this.state, steps: [...this.state.steps, { id: step.id, state: 'running', exitCode: null }] });
        const result = await runInitializationCommand(this.launcher, { ...step, env }, this.abort.signal);
        const state = this.abort.signal.aborted ? 'cancelled' : result.failed ? 'failed' : 'succeeded';
        this.save({ ...this.state, steps: this.state.steps.map((s) => s.id === step.id ? { id: step.id, state, exitCode: result.exitCode } : s) });
        if (result.failed) throw new Error('initializer step failed');
      }
      for (const check of material.toolsPhase === 'agent-before-start' ? [] : material.tools) {
        const result = await runInitializationCommand(this.launcher, { ...check, env }, this.abort.signal);
        const passed = !result.failed && toolMatches(result.output, check.expected);
        this.save({ ...this.state, checks: [...this.state.checks, { key: check.key, passed, exitCode: result.exitCode, output: redactInitializationOutput(result.output, { ...this.launcher.baseEnv(env), ...material.secrets }) }] });
        if (!passed) throw new Error('tool check failed');
      }
      this.abort.signal.throwIfAborted();
      completed = true;
    } catch {
      // 系统错误和子进程输出都不原样记录，避免凭据进入 Runner 的调试日志或持久状态。
      const state = this.abort.signal.aborted ? 'cancelled' : 'failed';
      this.save({ ...this.state, state, steps: this.state.steps.map((s) => s.state === 'running' ? { ...s, state } : s), error: this.abort.signal.aborted ? '初始化已取消' : '初始化或工具检查失败，请检查镜像与初始化步骤' });
    } finally {
      if (secretDirectory) {
        try { await rm(secretDirectory, { recursive: true, force: true }); }
        catch { this.save({ ...this.state, state: 'failed', error: '初始化凭据清理失败，请重建容器' }); }
      }
    }
    if (completed && this.state.state === 'running') this.save({ ...this.state, state: this.abort.signal.aborted ? 'cancelled' : 'succeeded' });
    return this.status();
  }
  private async prepareSecrets(secrets: Record<string, string>): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'crewstation-runtime-secrets-'));
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      for (const [id, value] of Object.entries(secrets)) {
        const path = join(directory, id); await writeFile(path, value, { flag: 'wx', mode: 0o400 }); await this.launcher.chownToWorker(path);
      }
      await this.launcher.chownToWorker(directory);
      return directory;
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
}
