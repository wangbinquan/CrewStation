import type { Actor, RuntimeCheckDto, RuntimeCheckId, RuntimeCheckStage, RuntimeConfigId, StartRuntimeCheckRequest } from '@crewstation/contracts';
import { conflict, newId, notFound, precondition, validation } from '@crewstation/kernel';
import type { RuntimeCheck } from '../domain/runtimeCheck';
import { CHECK_STAGE_IDS, initialStages, isCheckTerminal } from '../domain/runtimeCheck';
import type { AgentRuntimeUseCaseDeps } from './dependencies';
import { resolveRuntimeUseCases } from './resolveRuntime';
import { adminOnly, checkToDto } from './toDto';

/** 固定测试内容：不带租户源码或业务数据；回文里必须出现该标记才算真实模型响应。 */
export const checkPrompt = (checkId: string) => {
  const token = `CREWSTATION_RUNTIME_CHECK_${checkId.slice(-8).toUpperCase()}`;
  return { prompt: `Reply with exactly this text and nothing else: ${token}`, expectedReply: token };
};

type MaterialFor = ReturnType<typeof resolveRuntimeUseCases>['materialFor'];

export function checkUseCases(deps: AgentRuntimeUseCaseDeps) {
  const { uow, clock } = deps;
  const { materialFor } = resolveRuntimeUseCases(deps);
  const loadCheck = async (configId: RuntimeConfigId, checkId: RuntimeCheckId): Promise<RuntimeCheck> => {
    const check = await uow.read.checks.get(checkId);
    if (!check || check.configId !== configId) throw notFound('运行环境检查', checkId);
    return check;
  };

  return {
    startCheck: async (actor: Actor, configId: RuntimeConfigId, input: StartRuntimeCheckRequest): Promise<RuntimeCheckDto> => {
      adminOnly(actor);
      const existing = await uow.read.checks.findByRequest(configId, actor.userId, input.clientRequestId);
      if (existing) {
        if (existing.revision !== input.revision) throw conflict('此请求标识已用于另一版本的检查，请保留原请求查询结果', { clientRequestId: input.clientRequestId });
        return checkToDto(existing);
      }
      const config = await uow.read.configs.getById(configId);
      if (!config) throw notFound('运行环境', configId);
      const revision = await uow.read.revisions.get(configId, input.revision);
      if (!revision) throw notFound('运行环境版本', `${configId}@${input.revision}`);
      const model = input.model ?? revision.defaultModel;
      if (!model) throw validation('请在版本里填写默认模型或在检查时指定模型');
      if (revision.models.length > 0 && !revision.models.includes(model)) throw validation(`模型 ${model} 不在此版本可绑定的模型名内`, { models: revision.models });
      const now = clock.now();
      const check: RuntimeCheck = { checkId: newId('chk') as RuntimeCheckId, configId, revision: revision.revision, contentHash: revision.contentHash, clientRequestId: input.clientRequestId, createdBy: actor.userId, model, state: 'queued', context: { kind: 'platform-namespace' }, stages: initialStages(revision), createdAt: now };
      await uow.run(async (scope) => {
        const raced = await scope.checks.findByRequest(configId, actor.userId, input.clientRequestId);
        if (raced) return;
        await scope.checks.insert(check);
        await scope.checkQueue.enqueue(check.checkId);
      });
      return checkToDto((await uow.read.checks.findByRequest(configId, actor.userId, input.clientRequestId)) ?? check);
    },
    getCheck: async (actor: Actor, configId: RuntimeConfigId, checkId: RuntimeCheckId): Promise<RuntimeCheckDto> => {
      adminOnly(actor);
      return checkToDto(await loadCheck(configId, checkId));
    },
    runQueuedCheck: (checkId: RuntimeCheckId, heartbeat: () => Promise<boolean>) => runQueuedCheck(deps, materialFor, checkId, heartbeat),
    assertCheckUsable: (check: RuntimeCheck | undefined): RuntimeCheck => {
      if (!check) throw notFound('运行环境检查');
      if (!isCheckTerminal(check.state)) throw precondition('检查尚未结束，请等待结果后再启用');
      return check;
    },
  };
}

function mergeStages(current: RuntimeCheckStage[], updates: RuntimeCheckStage[] | undefined): RuntimeCheckStage[] {
  if (!updates?.length) return current;
  const merged = [...current];
  for (const update of updates) {
    const at = merged.findIndex((s) => s.id === update.id);
    if (at >= 0) merged[at] = update; else merged.push(update);
  }
  return merged;
}

/** 工作器：排队 → 执行 → 终态。执行器丢失结果时记 unknown，不自动重跑有副作用的脚本。 */
async function runQueuedCheck(deps: AgentRuntimeUseCaseDeps, materialFor: MaterialFor, checkId: RuntimeCheckId, heartbeat: () => Promise<boolean>): Promise<void> {
  const { uow, executor, clock, logger } = deps;
  const save = async (check: RuntimeCheck): Promise<void> => { await uow.run((scope) => scope.checks.update(check)); };
  const queued = await uow.read.checks.get(checkId);
  if (!queued || queued.state !== 'queued') return;
  const config = await uow.read.configs.getById(queued.configId);
  const revision = config ? await uow.read.revisions.get(queued.configId, queued.revision) : undefined;
  let check: RuntimeCheck = { ...queued, state: 'running', startedAt: clock.now() };
  await save(check);
  const failInput = async (message: string) => {
    check = { ...check, state: 'failed', error: message, endedAt: clock.now(), stages: mergeStages(check.stages, [{ id: CHECK_STAGE_IDS.input, kind: 'input', name: '输入校验', state: 'failed', error: { code: 'internal_error', message } }]) };
    await save(check);
  };
  if (!config || !revision) return failInput('运行环境或版本已不存在');
  if (revision.contentHash !== check.contentHash) return failInput('版本内容与检查登记时不一致');
  let material;
  try { material = await materialFor(config, revision, { captureOutput: true }); } catch (error) { return failInput(error instanceof Error ? error.message : String(error)); }
  check = { ...check, stages: mergeStages(check.stages, [{ id: CHECK_STAGE_IDS.input, kind: 'input', name: '输入校验', state: 'succeeded', detail: `版本 ${revision.revision}，${revision.steps.length} 个步骤，${revision.secretNames.length} 个凭据已就位` }]) };
  await save(check);
  try {
    const outcome = await executor.run({ checkId, driver: config.driver, model: check.model ?? '', material, ...checkPrompt(checkId) }, async (progress) => {
      check = { ...check, context: { ...check.context, ...progress.context }, stages: mergeStages(check.stages, progress.stages) };
      await save(check);
    }, heartbeat);
    check = { ...check, state: outcome.state, ...(outcome.error ? { error: outcome.error } : {}), context: { ...check.context, ...outcome.context }, stages: mergeStages(check.stages, outcome.stages), endedAt: clock.now() };
  } catch (error) {
    logger.error('runtime check executor failed', { checkId, error: error instanceof Error ? error.message : String(error) });
    check = { ...check, state: 'unknown', error: `检查任务中途丢失，无法确认脚本是否已执行：${error instanceof Error ? error.message : String(error)}`, endedAt: clock.now() };
  }
  if (!isCheckTerminal(check.state)) check = { ...check, state: 'unknown' };
  await save(check);
}
