import type { RuntimeImageProbeInput, RuntimeImageProbeResult, RuntimeInitializationStatus } from '@crewstation/contracts';
import { ResourceIdSchema, RuntimeImageExecutionSnapshotSchema, RuntimeInitializationStatusSchema } from '@crewstation/contracts';
import { newResourceId, precondition } from '@crewstation/kernel';
import type { TaskEnvironment } from '../../domain/taskEnvironment';
import type { TestRunner } from '../../ports/platform';
import type { TaskRuntimeUseCaseDeps } from '../dependencies';
import { runProfileTestUseCase } from '../profileTest';
import type { TestEnvironmentInput } from '../testEnvironment';

interface ProbeDeps {
  create(input: TestEnvironmentInput): Promise<TaskEnvironment>;
  runner?: TestRunner;
  mcp?: ReadonlyArray<{ name: string; url: string }>;
  pollMs?: number;
}
const failed = (error: string, checks: RuntimeImageProbeResult['checks'] = []): RuntimeImageProbeResult => ({ state: 'failed', error, checks });
const unknown = (error: string): RuntimeImageProbeResult => ({ state: 'unknown', error, checks: [] });

/** 隔离空工作目录、无生产配置／数据；复用真实 Runner 及档位协议检查。清理由验证控制器单独确认。 */
export function runImageProbe(deps: TaskRuntimeUseCaseDeps, probe: ProbeDeps) {
  return async (input: RuntimeImageProbeInput, heartbeat: () => Promise<boolean>): Promise<RuntimeImageProbeResult> => {
    ResourceIdSchema.parse(input.validationId); ResourceIdSchema.parse(input.projectId); RuntimeImageExecutionSnapshotSchema.parse(input.snapshot);
    if (input.snapshot.validationId !== input.validationId || !Number.isFinite(Date.parse(input.deadline))) throw precondition('镜像验证身份或截止时间无效');
    if (!probe.runner) throw precondition('验证 Runner 通道尚未配置');
    if (!await heartbeat()) return unknown('验证已取消或租约丢失');
    const env = await probe.create({ validation: input, image: input.snapshot.image, ...(input.agent?.taskProfile ? { taskProfile: input.agent.taskProfile } : {}) });
    const ready = await waitReady(deps, probe, env, input, heartbeat);
    if ('state' in ready) return ready;
    const { observedImageId, status } = ready, runner = probe.runner;
    const identity = await runner.sendCommand(env.id, { id: newResourceId(), type: 'exec', execId: newResourceId(), command: ['id', '-u'], env: {}, timeoutSeconds: 10, wait: true }) as { exitCode?: number; stdout?: string };
    const checks = [{ key: 'worker-uid', passed: identity.exitCode === 0 && identity.stdout?.trim() === String(deps.settings.workerUid), output: identity.stdout?.slice(0, 100) ?? '', exitCode: identity.exitCode ?? null }];
    if (!checks[0]!.passed) return { ...failed('验证命令未使用平台 worker 身份', checks), observedImageId };
    if (input.agent) {
      if (!await heartbeat()) return unknown('验证已取消或租约丢失');
      const agent = input.agent, nonce = `CS_IMAGE_${newResourceId().replaceAll('-', '')}`;
      const runProfile = runProfileTestUseCase(deps, { createTestEnvironment: async () => env, release: async () => {}, runner, mcp: probe.mcp });
      const result = await runProfile({ testId: input.validationId, profile: agent.profileId, revision: agent.revision, launch: agent.launch, beforeStart: agent.beforeStart, image: input.snapshot.image,
        ...(agent.terminalTest ? { terminalTest: agent.terminalTest } : {}), prompt: `Reply with exactly this text and nothing else: ${nonce}`, expectedReply: nonce }, async () => {}, heartbeat);
      checks.push({ key: 'agent-protocol', passed: result.state === 'passed', output: result.state, exitCode: result.state === 'passed' ? 0 : null });
      if (result.state !== 'passed') return { state: result.state, error: '档位 beforeStart、工具或协议测试未通过', checks, observedImageId };
    }
    const final = input.agent ? RuntimeInitializationStatusSchema.parse(await runner.sendCommand(env.id, { id: newResourceId(), type: 'runtimeInitializationStatus' })) : status;
    const tools = input.snapshot.tools;
    if (tools.some((tool) => !final.checks.some((check) => check.key === tool.key && check.passed))) return { ...failed('工具检查未全部通过', [...checks, ...final.checks]), observedImageId };
    return { state: 'passed', checks: [...checks, ...final.checks], observedImageId };
  };
}

async function waitReady(deps: TaskRuntimeUseCaseDeps, probe: ProbeDeps, env: TaskEnvironment, input: RuntimeImageProbeInput, heartbeat: () => Promise<boolean>): Promise<{ observedImageId: string; status: RuntimeInitializationStatus } | RuntimeImageProbeResult> {
  for (;;) {
    if (!await heartbeat()) return unknown('验证已取消或租约丢失');
    const live = await deps.uow.read.environments.getById(env.id), pod = await deps.cluster.podPhase(env);
    if (!live || ['failed', 'releasing', 'released'].includes(live.state)) return failed('验证环境未能完成初始化');
    if (live.runnerRejection) return failed('验证镜像 Runner 协议不兼容');
    if (live.state === 'running' && live.connected) {
      const connection = await probe.runner!.connectionStatus(env.id);
      if (!connection.connected || connection.capabilities?.runtimeInitialization !== 1) return failed('镜像不支持初始化能力握手');
      if (!pod.imageId || !(pod.imageId === input.snapshot.digest || pod.imageId.endsWith(`@${input.snapshot.digest}`))) return failed('实际运行镜像摘要与所选版本不一致');
      const status = live.runtimeInitialization;
      if (status?.state !== 'succeeded') return failed('初始化成功回执缺失');
      return { observedImageId: pod.imageId, status };
    }
    if (Date.now() >= Date.parse(input.deadline)) return failed('验证超过截止时间');
    await Bun.sleep(probe.pollMs ?? 1000);
  }
}
