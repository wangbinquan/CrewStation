import type { Actor, BotConversationDto, BotExecutionDto, BotHistoryQuery, BotReceiptDto, FreshBotContextRequest, InterruptBotRequest, SendBotMessageRequest, TaskId } from '@crewstation/contracts';
import { conflict, forbidden, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BotConversation, BotConversationRepository, BotOperation } from '../../ports/botConversations';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { reserveDevelopmentImage } from '../runtimeImageSelection';

export function botConversationUseCases(deps: DevSessionUseCaseDeps, repo: BotConversationRepository) {
  const guard = async (actor: Actor, taskId: TaskId, write: boolean) => {
    const env = await deps.environments.getEnvironment(taskId);
    if (!env || env.native) throw notFound('开发会话', taskId);
    await deps.authorizer.authorize(actor, env.projectId, write ? 'develop' : 'view');
    if (!await deps.environments.canOpenStream(actor, taskId)) throw forbidden('无权查看或操作该会话');
    if (write && (env.state !== 'running' || !env.connected)) throw precondition('开发容器尚未连接或正在释放');
    return env;
  };
  return {
    getBot: async (actor: Actor, taskId: TaskId) => {
      await guard(actor, taskId, false);
      const current = await repo.get(taskId);
      const pending = (await repo.pending(taskId)).find(op => op.kind === 'message' && op.content);
      return { conversation: current ? { ...toBotDto(current, current.currentAgentId ? await repo.execution(current.currentAgentId) : undefined), ...(pending ? { pendingMessage: { id: pending.requestId, content: pending.content!, createdAt: pending.createdAt } } : {}) } : null };
    },
    botHistory: async (actor: Actor, taskId: TaskId, query: BotHistoryQuery) => {
      await guard(actor, taskId, false);
      const rows = await repo.history(taskId, query.after, query.limit + 1), items = rows.slice(0, query.limit).map(executionDto);
      return { items, ...(rows.length > query.limit ? { next: items.at(-1)!.agentId } : {}) };
    },
    sendBotMessage: async (actor: Actor, taskId: TaskId, input: SendBotMessageRequest): Promise<BotReceiptDto> => {
      const env = await guard(actor, taskId, true);
      return repo.withLock(taskId, async () => {
        const old = await originalReceipt(repo, taskId, input.requestId, 'message', input);
        if (old) return old;
        let current = await repo.get(taskId);
        checkRevision(current, input.expectedRevision);
        if (current && (current.continuity === 'unavailable' || !['empty', 'awaiting-input', 'paused'].includes(current.state))) throw precondition(current.reason ?? '请等待当前执行完成或停止后继续', { code: 'bot_not_ready' });
        if (current && (input.compute || input.runtimeImageVersionId)) throw conflict('当前上下文的档位与镜像已经固定');
        if (!current) current = await newConversation(deps, actor, env, input);
        const next = { ...current, revision: current.revision + 1, state: 'preparing' as const, reason: undefined, updatedAt: deps.clock.now().toISOString() };
        const operation = makeOperation(next, input.requestId, 'message', input, deps.clock.now().toISOString());
        operation.content = input.content;
        await repo.accept(next, operation);
        return operation.receipt;
      });
    },
    interruptBot: async (actor: Actor, taskId: TaskId, input: InterruptBotRequest): Promise<BotReceiptDto> => {
      await guard(actor, taskId, true);
      return repo.withLock(taskId, async () => {
        const old = await originalReceipt(repo, taskId, input.requestId, 'interrupt', input); if (old) return old;
        const current = await repo.get(taskId); checkRevision(current, input.expectedRevision);
        if (!current?.currentAgentId) throw precondition('没有正在执行的 Bot');
        const execution = await repo.execution(current.currentAgentId);
        if (execution?.executionTaskId !== input.expectedExecutionId) throw conflict('当前执行已经变化，请刷新后重试');
        const next = { ...current, revision: current.revision + 1, state: 'stopping' as const, updatedAt: deps.clock.now().toISOString() };
        const operation = makeOperation(next, input.requestId, 'interrupt', input, next.updatedAt);
        operation.agentId = current.currentAgentId; operation.expectedExecutionId = input.expectedExecutionId;
        await repo.accept(next, operation); return operation.receipt;
      });
    },
    freshBotContext: async (actor: Actor, taskId: TaskId, input: FreshBotContextRequest): Promise<BotReceiptDto> => {
      await guard(actor, taskId, true);
      return repo.withLock(taskId, async () => {
        const old = await originalReceipt(repo, taskId, input.requestId, 'fresh', input); if (old) return old;
        const current = await repo.get(taskId); checkRevision(current, input.expectedRevision);
        if (!current) throw precondition('尚未创建 Bot 上下文');
        if (current.state === 'stopping' || (await repo.pending(taskId)).some((op) => op.kind !== 'message')) throw precondition('正在确认原执行停止，请稍后再试');
        const next = { ...current, revision: current.revision + 1, state: 'stopping' as const, updatedAt: deps.clock.now().toISOString() };
        const operation = makeOperation(next, input.requestId, 'fresh', input, next.updatedAt);
        operation.agentId = current.currentAgentId;
        await repo.accept(next, operation); return operation.receipt;
      });
    },
  };
}

async function newConversation(deps: DevSessionUseCaseDeps, actor: Actor, env: { id: TaskId; projectId: Parameters<DevSessionUseCaseDeps['compute']['resolve']>[2] }, input: SendBotMessageRequest): Promise<BotConversation> {
  const resolved = await deps.compute.resolve(input.compute, 'agent', env.projectId);
  if (resolved.protocol !== 'opencode') throw precondition('此档位协议尚未验证持久 Bot 上下文；原独立 Agent 入口仍可使用', { code: 'bot_protocol_unsupported' });
  const reservedExecutionId = newResourceId() as TaskId;
  const runtimeImage = await reserveDevelopmentImage(deps, actor, env.projectId, { type: 'agent', id: reservedExecutionId }, input.runtimeImageVersionId, { profileId: resolved.id, revision: resolved.revision });
  const now = deps.clock.now().toISOString();
  return { id: newResourceId(), taskId: env.id, revision: 0, epoch: 1, createdBy: actor.userId, reservedExecutionId,
    compute: resolved.id, computeName: resolved.name, protocol: resolved.protocol, profile: { profileId: resolved.id, revision: resolved.revision },
    executionConfig: { image: runtimeImage?.image ?? resolved.image, ...(runtimeImage ? { runtimeImage } : {}), ...(resolved.taskProfile ? { taskProfile: resolved.taskProfile } : {}) },
    state: 'empty', continuity: 'unknown', createdAt: now, updatedAt: now };
}
function checkRevision(current: BotConversation | undefined, expected: number): void {
  if ((current?.revision ?? 0) !== expected) throw conflict('Bot 对话已在其他页面变化，请刷新后继续', { code: 'bot_revision_conflict' });
}
async function originalReceipt(repo: BotConversationRepository, taskId: TaskId, requestId: string, kind: BotOperation['kind'], input: unknown): Promise<BotReceiptDto | undefined> {
  const old = await repo.operation(taskId, requestId);
  if (old && (old.digest !== jsonHash(input) || old.kind !== kind)) throw conflict('请求标识已用于不同内容', { code: 'bot_request_conflict' });
  return old?.receipt;
}
function makeOperation(current: BotConversation, requestId: string, kind: BotOperation['kind'], input: unknown, createdAt: string): BotOperation {
  return { taskId: current.taskId, requestId, digest: jsonHash(input), kind, createdAt, receipt: { requestId, conversationId: current.id, revision: current.revision, epoch: current.epoch, state: 'accepted' } };
}
export function executionDto(row: BotExecutionDto): BotExecutionDto {
  return { initialPrompt: row.initialPrompt, agentId: row.agentId, executionTaskId: row.executionTaskId, epoch: row.epoch, state: row.state, createdAt: row.createdAt, ...(row.nativeSessionId ? { nativeSessionId: row.nativeSessionId } : {}) };
}
export function toBotDto(current: BotConversation, execution?: BotExecutionDto): BotConversationDto {
  return { conversationId: current.id, taskId: current.taskId, revision: current.revision, epoch: current.epoch,
    state: current.state, continuity: current.continuity, computeName: current.computeName, profileRevision: current.profile.revision, protocol: current.protocol,
    ...(current.nativeSessionId ? { nativeSessionId: current.nativeSessionId } : {}), ...(current.volumeUid ? { volumeUid: current.volumeUid } : {}),
    ...(execution ? { execution: executionDto(execution) } : {}), ...(current.reason ? { reason: current.reason } : {}) };
}
