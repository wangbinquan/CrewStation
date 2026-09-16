import type { BeforeStartExecution, RunnerEvent, RuntimeCheckContext, RuntimeCheckStage, RuntimeDriver, TaskId } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import { RUNTIME_CHECK_COMPUTE, runtimeCheckAgentId } from '../domain/runtimeCheckEnvironment';
import { STAGE, absorbAgentEvent, cliConfigStage, modelStage, stagesFromBeforeStart } from '../domain/runtimeCheckStages';
import type { ModelProbe } from '../domain/runtimeCheckStages';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { CheckRunner } from '../ports/platform';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import type { RuntimeCheckInput, RuntimeCheckOutcome, RuntimeCheckProgress } from '../api/moduleApi';

export type { RuntimeCheckInput, RuntimeCheckOutcome, RuntimeCheckProgress };
export type RuntimeCheckReport = (progress: RuntimeCheckProgress) => Promise<void>;

export interface RuntimeCheckTiming { pollMs: number; connectTimeoutMs: number; modelBudgetMs: number }
const sleep = (ms: number) => Bun.sleep(ms);
const DEFAULT_TIMING: RuntimeCheckTiming = { pollMs: 1000, connectTimeoutMs: 5 * 60_000, modelBudgetMs: 5 * 60_000 };

export interface RuntimeCheckDeps {
  createCheck(input: { labels?: Record<string, string> }): Promise<TaskEnvironment>;
  release(taskId: TaskId): Promise<unknown>;
  checkRunner?: CheckRunner;
  timing?: Partial<RuntimeCheckTiming>;
}

const BINARY: Record<RuntimeDriver, string> = { 'claude-code': 'claude', opencode: 'opencode' };

/**
 * 运行环境检查的执行器（RFC-004 §7）：建平台检查任务 → 等 Runner 连上 → 读镜像／CLI 版本 →
 * 以固定材料启动一个 oneshot Agent → 按事件更新阶段 → 释放任务。Runner 丢失且无法确认时报 unknown，不自动重跑。
 */
export function runRuntimeCheckUseCase(deps: TaskRuntimeUseCaseDeps, check: RuntimeCheckDeps) {
  const timing: RuntimeCheckTiming = { ...DEFAULT_TIMING, ...check.timing };
  const { uow, cluster, settings, logger } = deps;

  const waitConnected = async (taskId: TaskId, heartbeat: () => Promise<boolean>): Promise<TaskEnvironment | { failure: string }> => {
    const deadline = Date.now() + timing.connectTimeoutMs;
    for (;;) {
      if (!await heartbeat()) return { failure: 'lease-lost' };
      const env = await uow.read.environments.getById(taskId);
      if (!env) return { failure: '检查任务记录丢失' };
      if (env.connected) return env;
      if (env.state === 'failed') return { failure: env.message ?? '检查容器启动失败' };
      const pod = await cluster.podPhase(env);
      if (pod.phase === 'Failed' || pod.phase === 'Succeeded') return { failure: `检查容器已退出${pod.message ? `：${pod.message}` : ''}` };
      if (Date.now() > deadline) return { failure: `检查容器 ${Math.round(timing.connectTimeoutMs / 1000)} 秒内未连接${pod.message ? `：${pod.message}` : ''}` };
      await sleep(timing.pollMs);
    }
  };

  const cliVersion = async (runner: CheckRunner, taskId: TaskId, driver: RuntimeDriver): Promise<string | null> => {
    try {
      const result = await runner.sendCommand(taskId, { id: `chk-version-${crypto.randomUUID()}`, type: 'exec', execId: `version-${crypto.randomUUID()}`, command: [BINARY[driver], '--version'], env: {}, timeoutSeconds: 30, wait: true }) as { exitCode: number | null; stdout: string };
      return result.exitCode === 0 ? result.stdout.trim().split('\n')[0] ?? null : null;
    } catch { return null; }
  };

  return async (input: RuntimeCheckInput, report: RuntimeCheckReport, heartbeat: () => Promise<boolean>): Promise<RuntimeCheckOutcome> => {
    const runner = check.checkRunner;
    if (!runner) return { state: 'failed', error: '本进程未配置检查执行通道', stages: [] };
    let env: TaskEnvironment;
    try { env = await check.createCheck({ labels: { 'crewstation.io/runtime-check': input.checkId } }); }
    catch (error) { return { state: 'failed', error: `无法创建检查任务：${error instanceof Error ? error.message : String(error)}`, stages: [] }; }
    const context: Partial<RuntimeCheckContext> = { taskId: env.id, image: settings.taskImage, workdir: '/work' };
    await report({ context });
    try {
      const connected = await waitConnected(env.id, heartbeat);
      if ('failure' in connected) return connected.failure === 'lease-lost' ? { state: 'unknown', error: '检查作业租约丢失', context, stages: [] } : { state: 'failed', error: connected.failure, context, stages: [] };
      const [status, pod] = await Promise.all([runner.connectionStatus(env.id), cluster.podPhase(env)]);
      Object.assign(context, { ...(pod.imageId ? { imageDigest: pod.imageId } : {}), ...(status.capabilities?.interpreters ? { interpreters: status.capabilities.interpreters } : {}), cliVersion: await cliVersion(runner, env.id, input.driver) });
      await report({ context });
      return await observeCheck({ deps, timing, runner, env, input, report, heartbeat, context });
    } finally {
      await check.release(env.id).catch((error: unknown) => logger.warn('runtime check environment release failed', { taskId: env.id, error: String(error) }));
    }
  };
}

interface ObserveInput { deps: TaskRuntimeUseCaseDeps; timing: RuntimeCheckTiming; runner: CheckRunner; env: TaskEnvironment; input: RuntimeCheckInput; report: RuntimeCheckReport; heartbeat: () => Promise<boolean>; context: Partial<RuntimeCheckContext> }

/** 启动 oneshot Agent 后按事件推进阶段；容器失败／Runner 失联／租约丢失一律 unknown，超时才主动取消。 */
async function observeCheck({ deps, timing, runner, env, input, report, heartbeat, context }: ObserveInput): Promise<RuntimeCheckOutcome> {
  const { uow } = deps;
  const agentId = runtimeCheckAgentId(input.checkId);
  try {
    await runner.sendCommand(env.id, { id: `chk-start-${input.checkId}`, type: 'startAgent', agentId, compute: RUNTIME_CHECK_COMPUTE, driver: input.driver, model: input.model, permission: 'read-only', mode: 'oneshot', initialPrompt: input.prompt, mcp: [], env: {}, runtime: input.material, processAttemptId: `${input.checkId}:1` });
  } catch (error) {
    const message = isPlatformError(error) ? error.message : String(error);
    return { state: 'failed', error: message, context, stages: [{ id: STAGE.cliConfig, kind: 'cli-config', name: '最终 CLI 配置校验', state: 'failed', error: { code: 'internal_error', message } }] };
  }
  const scriptBudget = input.material.steps.reduce((sum, s) => sum + (s.kind === 'script' ? s.timeoutMs : 0), 0);
  const deadline = Date.now() + scriptBudget + timing.modelBudgetMs;
  let sinceSeq = 0, probe: ModelProbe = { started: false, text: '' }, execution: BeforeStartExecution | undefined, disconnectedSince: number | undefined;
  for (;;) {
    if (!await heartbeat()) return { state: 'unknown', error: '检查作业租约丢失，无法确认脚本是否已执行', context, stages: current() };
    const events = await runner.listEvents(env.id, { sinceSeq, kinds: ['beforeStart', 'agent'], agentId, limit: 500 });
    for (const stored of events) { sinceSeq = stored.seq; absorb(stored.event); }
    if (events.length) await report({ stages: current() });
    if (probe.outcome) return finish();
    if (execution?.state === 'failed' || execution?.state === 'cancelled') return finish();
    const live = await uow.read.environments.getById(env.id);
    // 容器已失败或被回收：脚本是否已执行无从确认，记 unknown，不自动重跑（RFC-004 §5.2）。
    if (!live || live.state === 'failed' || live.state === 'released' || live.state === 'releasing') return { state: 'unknown', error: `检查容器在中途${live?.message ? `失败（${live.message}）` : '消失'}，无法确认脚本与模型结果`, context, stages: current() };
    if (!live.connected) { disconnectedSince ??= Date.now(); if (Date.now() - disconnectedSince > 30_000) return { state: 'unknown', error: 'Runner 在检查中途失联，无法确认脚本与模型结果', context, stages: current() }; }
    else disconnectedSince = undefined;
    if (Date.now() > deadline) {
      await runner.sendCommand(env.id, { id: `chk-cancel-${input.checkId}`, type: 'cancelAgent', agentId }).catch(() => undefined);
      return { state: 'failed', error: `检查超过 ${Math.round((scriptBudget + timing.modelBudgetMs) / 1000)} 秒未完成`, context, stages: current() };
    }
    await sleep(timing.pollMs);
  }
  function absorb(event: RunnerEvent): void {
    if (event.kind === 'beforeStart' && event.execution.agentId === agentId) execution = event.execution;
    if (event.kind === 'agent' && event.event.agentId === agentId) probe = absorbAgentEvent(probe, event.event);
  }
  function current(): RuntimeCheckStage[] {
    const stages: RuntimeCheckStage[] = execution ? stagesFromBeforeStart(execution) : [];
    const cli = cliConfigStage(probe); if (cli) stages.push(cli);
    stages.push(modelStage(probe, input.expectedReply));
    return stages;
  }
  function finish(): RuntimeCheckOutcome {
    const stages = current();
    if (probe.outcome?.kind === 'cancelled') return { state: 'cancelled', error: '检查被取消', context, stages };
    const failed = stages.find((s) => s.state === 'failed');
    return failed ? { state: 'failed', error: failed.error?.message ?? `${failed.name}失败`, context, stages } : { state: 'succeeded', context, stages };
  }
}
