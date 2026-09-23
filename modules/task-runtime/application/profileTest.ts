import { newResourceId } from '@crewstation/kernel';
import type { BeforeStartExecution, McpConnection, ProbeTerminalResult, ProfileTestContext, ProfileTestOutcome, ProfileTestStage, RunnerEvent, TaskId } from '@crewstation/contracts';
import { ProbeTerminalResultSchema, TASKRUNNER_PROTOCOL_VERSION, isKnownProtocol } from '@crewstation/contracts';
import { isPlatformError } from '@crewstation/kernel';
import type { ProfileTestRunInput, ProfileTestRunProgress, ProfileTestRunResult } from '../api/moduleApi';
import { CONTAINER_START_FAILURES, IMAGE_PULL_FAILURES, RUNNER_UNAVAILABLE_HINT } from '../domain/podStartup';
import { profileTestMcp } from '../domain/profileTestEnvironment';
import type { ProtocolProbe } from '../domain/profileTestStages';
import { TEST_STAGE, absorbAgentEvent, commandVerdict, containerStagesForTest, launchStage, modelVerdict, stagesFromBeforeStart } from '../domain/profileTestStages';
import type { TaskEnvironment } from '../domain/taskEnvironment';
import type { TestRunner } from '../ports/platform';
import type { TaskRuntimeUseCaseDeps } from './dependencies';
import type { TestEnvironmentInput } from './testEnvironment';

export type ProfileTestReport = (progress: ProfileTestRunProgress) => Promise<void>;
export interface ProfileTestTiming { pollMs: number; connectTimeoutMs: number; modelBudgetMs: number; disconnectGraceMs: number }
const DEFAULT_TIMING: ProfileTestTiming = { pollMs: 1000, connectTimeoutMs: 5 * 60_000, modelBudgetMs: 5 * 60_000, disconnectGraceMs: 30_000 };

export interface ProfileTestDeps {
  createTestEnvironment(input: TestEnvironmentInput): Promise<TaskEnvironment>;
  release(taskId: TaskId): Promise<unknown>;
  runner?: TestRunner;
  timing?: Partial<ProfileTestTiming>;
  /** 平台两个 MCP 的服务域地址；步骤模板引用 `{{mcp.*}}` 时测试才用得上（profileTestMcp）。 */
  mcp?: ReadonlyArray<{ name: string; url: string }>;
}

interface Session {
  readonly deps: TaskRuntimeUseCaseDeps; readonly timing: ProfileTestTiming; readonly runner: TestRunner; readonly env: TaskEnvironment;
  readonly input: ProfileTestRunInput; readonly report: ProfileTestReport; readonly heartbeat: () => Promise<boolean>; readonly context: Partial<ProfileTestContext>;
  readonly mcp: McpConnection[];
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const scriptBudgetOf = (input: ProfileTestRunInput): number => input.beforeStart.steps.reduce((sum, s) => sum + (s.kind === 'script' ? s.timeoutMs : 0), 0);
const result = (s: Pick<Session, 'context'>, state: ProfileTestRunResult['state'], outcome: ProfileTestOutcome | undefined, error: string | undefined, stages: ProfileTestStage[]): ProfileTestRunResult =>
  ({ state, ...(outcome ? { outcome } : {}), ...(error ? { error } : {}), context: s.context, stages });

/**
 * 档位测试的执行器（RFC-006 §6）：在平台命名空间按档位的镜像与资源建测试任务 → 等 Runner 握手 → 读镜像摘要与 CLI 版本 →
 * 已知协议发一次 oneshot 的 nonce 轮次，通用终端发 probeTerminal → 按事件推进阶段 → 释放任务。
 * 环境或 Runner 中途丢失、无法确认启动前脚本是否已执行时报 unknown，不自动重跑。
 */
export function runProfileTestUseCase(deps: TaskRuntimeUseCaseDeps, test: ProfileTestDeps) {
  const timing: ProfileTestTiming = { ...DEFAULT_TIMING, ...test.timing };
  return async (input: ProfileTestRunInput, report: ProfileTestReport, heartbeat: () => Promise<boolean>): Promise<ProfileTestRunResult> => {
    const runner = test.runner;
    if (!runner) return { state: 'failed', error: '本进程未配置测试执行通道', stages: [] };
    let env: TaskEnvironment;
    try { env = await test.createTestEnvironment({ image: input.image, ...(input.taskProfile ? { taskProfile: input.taskProfile } : {}), labels: { 'crewstation.io/profile-test': input.testId, 'crewstation.io/compute-profile': input.profile, 'crewstation.io/profile-revision': String(input.revision) } }); }
    catch (error) { return { state: 'failed', error: `无法创建测试任务：${messageOf(error)}`, stages: [] }; }
    const session: Session = { deps, timing, runner, env, input, report, heartbeat, context: { kind: 'platform-namespace', taskId: env.id, agentId: newResourceId(), image: input.image, workdir: '/work' }, mcp: profileTestMcp(input.beforeStart.steps, test.mcp ?? []) };
    try {
      await report({ context: session.context, stages: containerStagesForTest(env.startup) });
      const waited = await waitForRunner(session);
      if (waited) return waited;
      await describeRunner(session);
      return isKnownProtocol(input.launch.protocol) ? await observeProtocolTurn(session) : await runTerminalProbe(session);
    } finally {
      await test.release(env.id).catch((error: unknown) => deps.logger.warn('profile test environment release failed', { taskId: env.id, error: String(error) }));
    }
  };
}

/**
 * 等 Runner 连上：镜像拉取失败、容器起不来（不是平台底座）、握手被拒（协议不一致）、超时各有归类；连上返回 undefined。
 * 前三段的进度取测试环境自己的启动进度（RFC-022 D8），变了才上报；判定仍按 Pod 状态，规则不变。
 */
async function waitForRunner(s: Session): Promise<ProfileTestRunResult | undefined> {
  const { deps: { uow, cluster }, timing, env, context } = s;
  const deadline = Date.now() + timing.connectTimeoutMs;
  let reported = JSON.stringify(env.startup ?? null);
  for (;;) {
    if (!await s.heartbeat()) return result(s, 'unknown', 'environment-lost', '测试作业租约丢失', []);
    const live = await uow.read.environments.getById(env.id);
    if (!live || live.state === 'released' || live.state === 'releasing') return result(s, 'unknown', 'environment-lost', '测试任务在 Runner 连上之前消失', []);
    const fail = (outcome: ProfileTestOutcome, message: string) => result(s, 'failed', outcome, message, containerStagesForTest(live.startup, { code: outcome, message }));
    if (live.runnerRejection) return fail('runner-protocol-mismatch', live.runnerRejection.message);
    if (live.connected) return undefined;
    const pod = await cluster.podPhase(live);
    const note = pod.message ? `：${pod.message}` : '';
    if (pod.waitingReason && IMAGE_PULL_FAILURES.has(pod.waitingReason)) return fail('image-pull-failed', `镜像拉取失败（${pod.waitingReason}）${note}`);
    if (live.state === 'failed' || pod.phase === 'Failed' || pod.phase === 'Succeeded' || pod.phase === 'Missing' || (pod.waitingReason && CONTAINER_START_FAILURES.has(pod.waitingReason))) {
      return fail('runner-unavailable', `测试容器没有起来：${RUNNER_UNAVAILABLE_HINT}${note || (live.message ? `：${live.message}` : '')}`);
    }
    if (pod.imageId) context.imageDigest = pod.imageId;
    const now = JSON.stringify(live.startup ?? null);
    if (now !== reported) { reported = now; await s.report({ context, stages: containerStagesForTest(live.startup) }); }
    if (Date.now() > deadline) return fail('timeout', `测试容器 ${Math.round(timing.connectTimeoutMs / 1000)} 秒内没有连上平台${note}`);
    await Bun.sleep(timing.pollMs);
  }
}

/** 连上之后记录镜像摘要、Runner 协议、解释器清单与 CLI 版本（已知协议执行 `<binaryPath> --version`，取不到记 null）。 */
async function describeRunner(s: Session): Promise<void> {
  const [status, pod] = await Promise.all([s.runner.connectionStatus(s.env.id).catch(() => ({ connected: true })), s.deps.cluster.podPhase(s.env)]);
  const capabilities = 'capabilities' in status ? status.capabilities : undefined;
  Object.assign(s.context, {
    runnerProtocol: TASKRUNNER_PROTOCOL_VERSION, ...(pod.imageId ? { imageDigest: pod.imageId } : {}), ...(capabilities?.interpreters ? { interpreters: capabilities.interpreters } : {}),
    cliVersion: isKnownProtocol(s.input.launch.protocol) ? await cliVersion(s) : null,
  });
  const live = await s.deps.uow.read.environments.getById(s.env.id);
  await s.report({ context: s.context, stages: containerStagesForTest(live?.startup, undefined, { connect: `Runner 协议 ${TASKRUNNER_PROTOCOL_VERSION}` }) });
}

async function cliVersion(s: Session): Promise<string | null> {
  try {
    const execId = newResourceId();
    const reply = await s.runner.sendCommand(s.env.id, { id: execId, type: 'exec', execId, command: [s.input.launch.binaryPath, '--version'], env: {}, timeoutSeconds: 30, wait: true }) as { exitCode: number | null; stdout: string };
    return reply.exitCode === 0 ? reply.stdout.trim().split('\n')[0]?.slice(0, 200) || null : null;
  } catch { return null; }
}

/**
 * 已知协议：发一次 oneshot 的 nonce 轮次，按事件推进阶段；截止时间 = 脚本预算＋模型预算，到点主动取消。
 * 权限取 full，与 agent-workflow 冒烟的系统 persona（`permission: {}`，工具全在）一致：按最小权限去掉 bash 之后，
 * 有的模型服务会拒绝这种请求（本机实测 OpenCode Zen 免费档对没有 bash 工具的请求答 403 FreeTierError），
 * 测试就会把一个可用的档位判成不可用。测试容器是临时的空工作目录，不带项目源码、数据与租户配置，提示词固定。
 */
async function observeProtocolTurn(s: Session): Promise<ProfileTestRunResult> {
  const { input, runner, env, timing } = s;
  const agentId = s.context.agentId!;
  try {
    await runner.sendCommand(env.id, {
      id: `pft-start-${input.testId}`, type: 'startAgent', agentId, compute: input.profile, profileRevision: input.revision, launch: input.launch, permission: 'full',
      mode: 'oneshot', initialPrompt: input.prompt, mcp: s.mcp, env: {}, beforeStart: input.beforeStart, processAttemptId: `${input.testId}:1`,
    });
  } catch (error) {
    const message = messageOf(error);
    const beforeStart = isPlatformError(error) && error.details?.code === 'interpreter_unavailable';
    return result(s, 'failed', beforeStart ? 'before-start-failed' : 'spawn-failed', message, [{ id: TEST_STAGE.agent, kind: 'agent', name: 'Agent 启动中', state: 'failed', error: { code: String((isPlatformError(error) && error.details?.code) || 'rejected'), message } }]);
  }
  const deadline = Date.now() + scriptBudgetOf(input) + timing.modelBudgetMs;
  const secrets = Object.values(input.beforeStart.secrets);
  let sinceSeq = 0, probe: ProtocolProbe = { started: false, text: '', diagnostics: '' }, execution: BeforeStartExecution | undefined;
  const absorb = (event: RunnerEvent): void => {
    if (event.kind === 'beforeStart' && event.execution.agentId === agentId) execution = event.execution;
    if (event.kind === 'agent' && event.event.agentId === agentId) probe = absorbAgentEvent(probe, event.event);
  };
  const stages = (timedOut: boolean): ProfileTestStage[] => [
    ...(execution ? stagesFromBeforeStart(execution) : []), launchStage(probe, execution?.state === 'succeeded' || probe.started), modelVerdict(probe, input.expectedReply, timedOut, !!input.launch.model, secrets).stage,
  ];
  const finish = (timedOut: boolean): ProfileTestRunResult => {
    if (execution?.state === 'failed' || execution?.state === 'cancelled') return result(s, 'failed', 'before-start-failed', execution.error?.message ?? '启动前步骤失败', stages(false));
    const verdict = modelVerdict(probe, input.expectedReply, timedOut, !!input.launch.model, secrets);
    return verdict.stage.state === 'succeeded' ? result(s, 'passed', 'passed', undefined, stages(false)) : result(s, 'failed', verdict.outcome, verdict.error, stages(timedOut));
  };
  const watch = watchEnvironment(s);
  for (;;) {
    if (!await s.heartbeat()) return result(s, 'unknown', 'environment-lost', '测试作业租约丢失，无法确认启动前脚本是否已执行', stages(false));
    const events = await runner.listEvents(env.id, { sinceSeq, kinds: ['beforeStart', 'agent'], agentId, limit: 500 }).catch(() => []);
    for (const stored of events) { sinceSeq = stored.seq; absorb(stored.event); }
    if (events.length) await s.report({ stages: stages(false) });
    if (probe.outcome || execution?.state === 'failed' || execution?.state === 'cancelled') return finish(false);
    const lost = await watch();
    if (lost) return result(s, 'unknown', 'environment-lost', lost, stages(false));
    if (Date.now() > deadline) {
      await runner.sendCommand(env.id, { id: `pft-cancel-${input.testId}`, type: 'cancelAgent', agentId }).catch(() => undefined);
      return finish(true);
    }
    await Bun.sleep(timing.pollMs);
  }
}

/** 通用终端：probeTerminal 在 Runner 里先跑启动前步骤再执行测试命令；等回执期间按事件推进步骤阶段。 */
async function runTerminalProbe(s: Session): Promise<ProfileTestRunResult> {
  const { input, runner, env, timing } = s;
  const test = input.terminalTest;
  if (!test) return result(s, 'failed', 'output-mismatch', '通用终端档位缺少测试命令，请编辑档位补上测试命令与期望输出', []);
  const probeId = s.context.agentId!;
  let settled: { ok: true; value: ProbeTerminalResult } | { ok: false; error: unknown } | undefined;
  void runner.sendCommand(env.id, {
    id: `pft-probe-${input.testId}`, type: 'probeTerminal', probeId, compute: input.profile, profileRevision: input.revision, launch: input.launch,
    command: test.command, expect: test.expect, timeoutMs: test.timeoutMs, mcp: s.mcp, env: {}, beforeStart: input.beforeStart, processAttemptId: `${input.testId}:1`,
  }).then((payload) => { settled = { ok: true, value: ProbeTerminalResultSchema.parse(payload) }; }, (error: unknown) => { settled = { ok: false, error }; });
  const deadline = Date.now() + scriptBudgetOf(input) + test.timeoutMs + 60_000;
  let sinceSeq = 0, execution: BeforeStartExecution | undefined;
  const steps = (): ProfileTestStage[] => (execution ? stagesFromBeforeStart(execution) : []);
  const drain = async (): Promise<number> => {
    const events = await runner.listEvents(env.id, { sinceSeq, kinds: ['beforeStart'], agentId: probeId, limit: 500 }).catch(() => []);
    for (const stored of events) { sinceSeq = stored.seq; if (stored.event.kind === 'beforeStart' && stored.event.execution.agentId === probeId) execution = stored.event.execution; }
    return events.length;
  };
  const watch = watchEnvironment(s);
  while (!settled) {
    if (!await s.heartbeat()) return result(s, 'unknown', 'environment-lost', '测试作业租约丢失，无法确认启动前脚本是否已执行', steps());
    if (await drain()) await s.report({ stages: [...steps(), { id: TEST_STAGE.command, kind: 'command', name: '测试命令', state: execution?.state === 'succeeded' ? 'running' : 'pending' }] });
    const lost = await watch();
    if (lost) return result(s, 'unknown', 'environment-lost', lost, steps());
    if (Date.now() > deadline) return result(s, 'unknown', 'environment-lost', 'Runner 在时限内没有返回测试命令的结果，无法确认启动前脚本是否已执行', steps());
    if (!settled) await Bun.sleep(timing.pollMs);
  }
  // 回执可能先于最后几条步骤事件被读到（Runner 先发步骤事件再回复，轮询间隔里只看到了「执行中」）：收尾前再读一遍，阶段才是终态。
  await drain();
  const outcome = settled as { ok: true; value: ProbeTerminalResult } | { ok: false; error: unknown };
  if (!outcome.ok) return result(s, 'failed', 'spawn-failed', `Runner 拒绝了测试命令：${messageOf(outcome.error)}`, steps());
  const probe = outcome.value;
  if (probe.beforeStart.state !== 'succeeded') return result(s, 'failed', 'before-start-failed', probe.beforeStart.error?.message ?? '启动前步骤失败', [...steps(), commandVerdict(undefined, test.expect).stage]);
  const verdict = commandVerdict(probe.command, test.expect);
  return verdict.stage.state === 'succeeded' ? result(s, 'passed', 'passed', undefined, [...steps(), verdict.stage]) : result(s, 'failed', verdict.outcome, verdict.error, [...steps(), verdict.stage]);
}

/** 测试中途环境失败、被回收或 Runner 失联超过宽限：返回原因（记 unknown），否则 undefined。 */
function watchEnvironment(s: Session): () => Promise<string | undefined> {
  let disconnectedSince: number | undefined;
  return async () => {
    const live = await s.deps.uow.read.environments.getById(s.env.id);
    if (!live || live.state === 'failed' || live.state === 'released' || live.state === 'releasing') return `测试容器在中途${live?.message ? `失败（${live.message}）` : '消失'}，无法确认启动前脚本与测试结果`;
    if (live.connected) { disconnectedSince = undefined; return undefined; }
    disconnectedSince ??= Date.now();
    return Date.now() - disconnectedSince > s.timing.disconnectGraceMs ? 'Runner 在测试中途失联，无法确认启动前脚本与测试结果' : undefined;
  };
}
