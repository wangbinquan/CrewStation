import type { AgentEvent, BeforeStartMaterial } from '@crewstation/contracts';
import type { Logger } from '@crewstation/kernel';
import type { BeforeStartRunner } from '../beforeStart/beforeStartRunner';
import { BeforeStartFailure } from '../beforeStart/failure';
import { RunnerCommandError } from '../commandError';
import type { ProcessLauncher } from '../process/launcher';
import type { AgentDriver, AgentLaunchContext, AgentProcess, AgentSpec } from './driver';
import { createAgentEventFactory } from './driver';
import { createEventQueue } from './eventQueue';

export interface ManagedAgentDeps {
  driver: AgentDriver;
  beforeStart: BeforeStartRunner;
  launcher: ProcessLauncher;
  cwd: string;
  /** 平台经命令追加的变量；模型凭据由档位修订的启动前材料给出。 */
  commandEnv: Record<string, string>;
  material: BeforeStartMaterial;
  processAttemptId: string;
  logger: Logger;
}

/**
 * 托管 Agent：先跑完启动前 Hook，再创建 CLI 进程（RFC-004 §5；RFC-006 起每次启动都走这里）。
 * 准备期间“环境准备中”不冒充“Agent 正在执行”；失败只发一条 before_start_failed 的 error 事件，不创建 CLI。
 */
export class ManagedAgentProcess implements AgentProcess {
  readonly events = createEventQueue<AgentEvent>();
  private readonly event: ReturnType<typeof createAgentEventFactory>;
  private inner: AgentProcess | undefined;
  private cancelled = false;
  private readonly ready: Promise<void>;

  constructor(private readonly spec: AgentSpec, private readonly deps: ManagedAgentDeps) {
    this.event = createAgentEventFactory(spec.agentId);
    this.ready = this.begin();
  }

  async send(text: string): Promise<void> {
    if (!this.inner) throw new RunnerCommandError('agent_preparing', '运行环境正在准备，尚不能发送消息');
    await this.inner.send(text);
  }

  async cancel(): Promise<void> {
    if (this.events.closed) return;
    if (!this.inner) {
      this.cancelled = true;
      this.deps.beforeStart.cancel(this.spec.agentId);
      await this.ready.catch(() => undefined);
      if (!this.events.closed) { this.events.push(this.event('cancelled', { result: { durationMs: 0 } })); this.events.close(); }
      return;
    }
    await this.inner.cancel();
  }

  private async begin(): Promise<void> {
    let outcome;
    try {
      outcome = await this.deps.beforeStart.run({ agentId: this.spec.agentId, processAttemptId: this.deps.processAttemptId, material: this.deps.material, workspace: this.deps.cwd, mcp: this.spec.mcp });
    } catch (error) {
      const failure = error instanceof BeforeStartFailure ? error : undefined;
      if (this.cancelled || failure?.code === 'cancelled') { if (!this.events.closed) { this.events.push(this.event('cancelled', { result: { durationMs: 0 } })); this.events.close(); } return; }
      const message = failure ? `环境准备失败：${failure.stepId ? `步骤 ${failure.stepId}，` : ''}${failure.message}` : `环境准备失败：${error instanceof Error ? error.message : String(error)}`;
      this.events.push(this.event('error', { error: { code: 'before_start_failed', message } }));
      this.events.close();
      return;
    }
    if (this.cancelled) return;
    const env = this.deps.launcher.baseEnv({ ...this.deps.commandEnv, ...outcome.env });
    const context: AgentLaunchContext = { cwd: this.deps.cwd, env, launcher: this.deps.launcher, logger: this.deps.logger, managed: { home: outcome.home, runDir: outcome.runDir, ...(outcome.configFile ? { configFile: outcome.configFile } : {}) } };
    this.inner = this.deps.driver.start(this.spec, context);
    void this.forward(this.inner);
  }

  private async forward(inner: AgentProcess): Promise<void> {
    try { for await (const event of inner.events) this.events.push(event); }
    catch (error) { this.events.push(this.event('error', { error: { code: 'driver_failed', message: error instanceof Error ? error.message : String(error) } })); }
    finally { this.events.close(); }
  }
}
