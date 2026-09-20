import type { Actor, ProfileTestDto, ProfileTestId, StartProfileTestRequest } from '@crewstation/contracts';
import { conflict, notFound } from '@crewstation/kernel';
import type { ProfileTest } from '../domain/profileTest';
import { TEST_STAGE, isTestTerminal, mergeStages, skipUnreachedStages, testPrompt } from '../domain/profileTest';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { profileQueries } from './profileQueries';
import { queuedTest } from './profileWrites';
import { resolveProfileUseCases } from './resolveProfile';
import { adminOnly, testToDto } from './toDto';

/** 手动重测与查询；保存触发的测试在 profileWrites 里与修订同一事务排队。 */
export function profileTestUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, clock } = deps;
  const { load } = profileQueries(deps);
  return {
    startTest: async (actor: Actor, name: string, input: StartProfileTestRequest): Promise<ProfileTestDto> => {
      adminOnly(actor);
      const existing = await uow.read.tests.findByRequest(name, actor.userId, input.clientRequestId);
      if (existing) return testToDto(existing);
      const { profile, revision } = await load(name);
      const test = queuedTest(revision, profile.protocol, 'manual', actor.userId, clock.now(), input.clientRequestId);
      await uow.run(async (scope) => {
        if (await scope.tests.findByRequest(name, actor.userId, input.clientRequestId)) return;
        await scope.tests.insert(test);
        await scope.testQueue.enqueue(test.testId);
      });
      return testToDto((await uow.read.tests.findByRequest(name, actor.userId, input.clientRequestId)) ?? test);
    },
    getTest: async (actor: Actor, name: string, testId: ProfileTestId): Promise<ProfileTestDto> => {
      adminOnly(actor);
      const test = await uow.read.tests.get(testId);
      if (!test || test.profile !== name) throw notFound('档位测试', testId);
      return testToDto(test);
    },
    stopClusterTest: async (actor: Actor, testId: ProfileTestId) => {
      adminOnly(actor); const test = await uow.read.tests.get(testId); if (!test) throw notFound('档位测试', testId);
      if (!isTestTerminal(test.state)) await uow.run((scope) => scope.tests.update({ ...test, state: 'unknown', outcome: 'environment-lost', error: '管理员停止了本次档位测试，不能判定为通过', endedAt: clock.now(), stages: skipUnreachedStages(test.stages) }));
    },
    runQueuedTest: (testId: ProfileTestId, heartbeat: () => Promise<boolean>) => runQueuedTest(deps, testId, heartbeat),
    assertTerminal: (test: ProfileTest): void => { if (!isTestTerminal(test.state)) throw conflict('测试尚未结束'); },
  };
}

/**
 * 工作器：排队 → 执行 → 终态。保存了新修订的测试已被置为 superseded：心跳随之失效，执行器提前收尾，
 * 结果不再覆盖 superseded。执行器丢失结果时记 unknown，不自动重跑有副作用的脚本（RFC-004 §5.2 沿用）。
 */
async function runQueuedTest(deps: AgentRuntimeUseCaseDeps, testId: ProfileTestId, heartbeat: () => Promise<boolean>): Promise<void> {
  const { uow, executor, clock, logger } = deps;
  const queued = await uow.read.tests.get(testId);
  if (!queued || queued.state !== 'queued') return;
  let test: ProfileTest = { ...queued, state: 'running', startedAt: clock.now() };
  const save = async (): Promise<void> => {
    const latest = await uow.read.tests.get(testId);
    if (latest && isTestTerminal(latest.state)) return;
    await uow.run((scope) => scope.tests.update(test));
  };
  const fail = async (outcome: ProfileTest['outcome'], message: string): Promise<void> => {
    test = { ...test, state: 'failed', ...(outcome ? { outcome } : {}), error: message, endedAt: clock.now() };
    await save();
  };
  const profile = await uow.read.profiles.get(queued.profile);
  const revision = profile ? await uow.read.revisions.get(queued.profile, queued.revision) : undefined;
  if (!profile || !revision || revision.contentHash !== queued.contentHash) return fail(undefined, '档位或修订已不存在，或内容与测试登记时不一致');
  await save();
  const resolver = resolveProfileUseCases(deps);
  let material;
  try { material = await resolver.materialFor(profile, revision, true); }
  catch (error) { return fail('before-start-failed', error instanceof Error ? error.message : String(error)); }
  const alive = async (): Promise<boolean> => (await heartbeat()) && (await uow.read.tests.get(testId))?.state === 'running';
  try {
    const result = await executor.run({
      testId, profile: profile.id, revision: revision.revision, launch: revision.content.launch, image: resolver.pinned(revision), beforeStart: material,
      ...(revision.content.taskProfile ? { taskProfile: revision.content.taskProfile } : {}), ...(revision.content.terminalTest ? { terminalTest: revision.content.terminalTest } : {}), ...testPrompt(),
    }, async (progress) => {
      test = { ...test, context: { ...test.context, ...progress.context }, stages: mergeStages(test.stages, progress.stages) };
      await save();
    }, alive);
    test = { ...test, state: result.state, ...(result.outcome ? { outcome: result.outcome } : {}), ...(result.error ? { error: result.error } : {}), context: { ...test.context, ...result.context }, stages: mergeStages(test.stages, result.stages), endedAt: clock.now() };
  } catch (error) {
    logger.error('profile test executor failed', { testId, error: error instanceof Error ? error.message : String(error) });
    test = { ...test, state: 'unknown', outcome: 'environment-lost', error: `测试环境中途丢失，无法确认启动前脚本是否已执行：${error instanceof Error ? error.message : String(error)}`, endedAt: clock.now(),
      stages: mergeStages(test.stages, test.stages.filter((s) => s.state === 'running').map((s) => ({ ...s, state: 'failed' as const }))) };
  }
  if (!isTestTerminal(test.state)) test = { ...test, state: 'unknown', outcome: 'environment-lost' };
  if (test.state === 'passed') test = { ...test, outcome: 'passed', stages: test.stages.map((s) => (s.id === TEST_STAGE.image && s.state === 'pending' ? { ...s, state: 'succeeded' } : s)) };
  else test = { ...test, stages: skipUnreachedStages(test.stages) };
  await save();
}
