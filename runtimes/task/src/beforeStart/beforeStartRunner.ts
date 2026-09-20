import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { platformMcpEndpoints } from '@crewstation/agent-drivers';
import type { BeforeStartExecution, BeforeStartMaterial, BeforeStartStepRecord, McpConnection, RunnerEvent } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { ProcessLauncher } from '../process/launcher';
import { asBeforeStartFailure, BeforeStartFailure } from './failure';
import { executeFileStep } from './fileStep';
import { resolveHookPath } from './hookPaths';
import type { InterpreterCatalog } from './interpreters';
import { executeScriptStep } from './scriptStep';
import { SharedPathRegistry } from './sharedPaths';
import type { HookContext } from './templateContext';

export const RUN_DIR_PREFIX = 'crewstation-agents';

export interface BeforeStartRequest {
  agentId: string;
  processAttemptId: string;
  material: BeforeStartMaterial;
  /** Agent 的工作目录（已解析）；脚本缺省在这里运行。 */
  workspace: string;
  /** 启动命令携带的 MCP 连接：平台两个 MCP 的地址与会话令牌由此进入 `{{mcp.*}}` 与脚本环境（RFC-006 C16）。 */
  mcp?: readonly McpConnection[];
  onProgress?: (execution: BeforeStartExecution) => void;
}

/** 全部步骤成功后交给 CLI 装配的产物；密钥值随 env 进程环境，不再出现在其他地方。 */
export interface BeforeStartOutcome {
  execution: BeforeStartExecution;
  /** 普通变量、凭据与脚本输出合并后的环境；HOME 指向私有家目录。 */
  env: Record<string, string>;
  home: string;
  runDir: string;
  configFile?: { kind: 'claude-settings' | 'opencode-config'; path: string };
}

export interface BeforeStartRunnerDeps { launcher: ProcessLauncher; interpreters: InterpreterCatalog; emit: (event: RunnerEvent) => void; logger: Logger; baseDir?: string }

interface Entry { execution: BeforeStartExecution; promise: Promise<BeforeStartOutcome>; abort: AbortController; agentId: string }

/**
 * 启动前 Hook 的执行器（RFC-004 §5）：同一容器串行执行，每个 attempt 只执行一次，
 * 同一 processAttemptId 的重发只拿回原结果；取消终止当前脚本进程组并跳过后续步骤。
 */
export class BeforeStartRunner {
  private readonly entries = new Map<string, Entry>();
  private readonly byAgent = new Map<string, Entry>();
  private readonly shared = new SharedPathRegistry();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly baseDir: string;

  constructor(private readonly deps: BeforeStartRunnerDeps) { this.baseDir = deps.baseDir ?? join(tmpdir(), RUN_DIR_PREFIX); }

  runDirFor(agentId: string): string { return join(this.baseDir, agentId); }
  homeFor(agentId: string): string { return join(this.runDirFor(agentId), 'home'); }

  run(request: BeforeStartRequest): Promise<BeforeStartOutcome> {
    const existing = this.entries.get(request.processAttemptId);
    if (existing) return existing.promise;
    const now = new Date().toISOString();
    const execution: BeforeStartExecution = {
      executionId: Bun.randomUUIDv7(), agentId: request.agentId, processAttemptId: request.processAttemptId,
      profile: { profileId: request.material.profile, revision: request.material.revision }, state: 'queued', queuedAt: now,
      steps: request.material.steps.map((step): BeforeStartStepRecord => ({ stepId: step.stepId, name: step.name, kind: step.kind, state: 'pending' })),
    };
    const abort = new AbortController();
    const entry: Entry = { execution, abort, agentId: request.agentId, promise: Promise.resolve() as unknown as Promise<BeforeStartOutcome> };
    entry.promise = this.queue.then(() => this.execute(entry, request), () => this.execute(entry, request));
    this.queue = entry.promise.catch(() => undefined);
    this.entries.set(request.processAttemptId, entry);
    this.byAgent.set(request.agentId, entry);
    this.publish(entry, request.onProgress);
    return entry.promise;
  }

  /** 取消该 Agent 排队或进行中的执行；已完成的不受影响。 */
  cancel(agentId: string): void {
    const entry = this.byAgent.get(agentId);
    if (entry && (entry.execution.state === 'queued' || entry.execution.state === 'running')) entry.abort.abort();
  }

  /** 进程结束：释放共享路径占用并清理私有目录；共享固定路径的文件不删。 */
  release(agentId: string): void {
    this.shared.release(agentId);
    this.byAgent.delete(agentId);
    try { rmSync(this.runDirFor(agentId), { recursive: true, force: true }); } catch { /* 容器消亡时 tmpdir 一并消失。 */ }
  }

  get(agentId: string): BeforeStartExecution | undefined { return this.byAgent.get(agentId)?.execution; }

  private async execute(entry: Entry, request: BeforeStartRequest): Promise<BeforeStartOutcome> {
    const { material } = request;
    const runDir = this.runDirFor(request.agentId), home = this.homeFor(request.agentId);
    const ctx: HookContext = { agentId: request.agentId, home, runDir, workspace: request.workspace, vars: { ...material.vars }, secrets: { ...material.secrets }, mcp: platformMcpEndpoints(request.mcp ?? []), env: {} };
    this.update(entry, { state: 'running', startedAt: new Date().toISOString() }, request.onProgress);
    try {
      if (entry.abort.signal.aborted) throw new BeforeStartFailure('cancelled', '启动在准备开始前被取消');
      await this.prepareDirectories(runDir, home);
      for (const step of material.steps) await this.runStep(entry, step, ctx, material.captureOutput, request.onProgress);
      const configFile = material.configFile.kind === 'none' ? undefined : { kind: material.configFile.kind, path: resolveHookPath(material.configFile.pathTemplate, ctx, 'config-file') };
      this.update(entry, { state: 'succeeded', endedAt: new Date().toISOString(), currentStepId: undefined }, request.onProgress);
      return { execution: entry.execution, env: { ...ctx.vars, ...ctx.secrets, ...ctx.env, HOME: home }, home, runDir, ...(configFile ? { configFile } : {}) };
    } catch (error) {
      const failure = asBeforeStartFailure(error);
      const cancelled = failure.code === 'cancelled' || entry.abort.signal.aborted;
      const steps = entry.execution.steps.map((s) => (s.state === 'pending' ? { ...s, state: cancelled ? 'cancelled' as const : 'skipped' as const } : s));
      this.update(entry, { state: cancelled ? 'cancelled' : 'failed', endedAt: new Date().toISOString(), currentStepId: undefined, steps, error: failure.toError() }, request.onProgress);
      this.shared.release(request.agentId);
      throw failure;
    }
  }

  private async runStep(entry: Entry, step: BeforeStartMaterial['steps'][number], ctx: HookContext, captureOutput: boolean, onProgress?: BeforeStartRequest['onProgress']): Promise<void> {
    if (entry.abort.signal.aborted) throw new BeforeStartFailure('cancelled', '启动被取消', step.stepId);
    const startedAt = Date.now();
    this.patchStep(entry, step.stepId, { state: 'running', startedAt: new Date(startedAt).toISOString() }, onProgress);
    try {
      if (step.kind === 'file') {
        const result = await executeFileStep(step, ctx, { launcher: this.deps.launcher, shared: this.shared });
        this.patchStep(entry, step.stepId, { state: 'succeeded', endedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, path: result.path }, onProgress);
        return;
      }
      const result = await executeScriptStep(step, ctx, { launcher: this.deps.launcher, interpreters: this.deps.interpreters, signal: entry.abort.signal });
      ctx.env = { ...ctx.env, ...result.output };
      this.patchStep(entry, step.stepId, { state: 'succeeded', endedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, path: result.cwd, exitCode: result.exitCode, outputVariables: Object.keys(result.output), ...(captureOutput ? { log: result.log } : {}) }, onProgress);
    } catch (error) {
      const failure = asBeforeStartFailure(error, step.stepId);
      const extra = error as { exitCode?: number | null; log?: { stdoutTail: string; stderrTail: string } };
      this.patchStep(entry, step.stepId, { state: failure.code === 'cancelled' ? 'cancelled' : 'failed', endedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, error: failure.toError(), ...(extra.exitCode === undefined ? {} : { exitCode: extra.exitCode }), ...(captureOutput && extra.log ? { log: extra.log } : {}) }, onProgress);
      this.deps.logger.warn('before-start step failed', { agentId: entry.agentId, stepId: step.stepId, code: failure.code });
      throw failure;
    }
  }

  private async prepareDirectories(runDir: string, home: string): Promise<void> {
    // 父目录必须可遍历，叶目录 0700 交给 worker（与 agent-drivers 的运行目录同一套约定）。
    mkdirSync(dirname(runDir), { recursive: true, mode: 0o755 });
    for (const dir of [runDir, home]) { mkdirSync(dir, { recursive: true, mode: 0o700 }); await this.deps.launcher.chownToWorker(dir); }
  }

  private patchStep(entry: Entry, stepId: string, patch: Partial<BeforeStartStepRecord>, onProgress?: BeforeStartRequest['onProgress']): void {
    const steps = entry.execution.steps.map((s) => (s.stepId === stepId ? { ...s, ...patch } : s));
    this.update(entry, { steps, currentStepId: patch.state === 'running' ? stepId : undefined }, onProgress);
  }

  private update(entry: Entry, patch: Partial<BeforeStartExecution>, onProgress?: BeforeStartRequest['onProgress']): void {
    const { currentStepId, ...rest } = patch;
    entry.execution = { ...entry.execution, ...rest };
    if ('currentStepId' in patch) { if (currentStepId === undefined) delete entry.execution.currentStepId; else entry.execution.currentStepId = currentStepId; }
    this.publish(entry, onProgress);
  }

  private publish(entry: Entry, onProgress?: BeforeStartRequest['onProgress']): void {
    const snapshot = structuredClone(entry.execution);
    this.deps.emit({ kind: 'beforeStart', execution: snapshot });
    onProgress?.(snapshot);
  }
}
