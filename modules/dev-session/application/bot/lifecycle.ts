import type { TaskId } from '@crewstation/contracts';
import { BotMessageReceiptSchema } from '@crewstation/contracts';
import { isPlatformError, jsonHash, precondition } from '@crewstation/kernel';
import type { AgentStartRepository } from '../../ports/agentStarts';
import type { BotConversation, BotConversationRepository, BotOperation } from '../../ports/botConversations';
import type { AgentExecutionLifecycle } from '../agentExecution';
import type { DevSessionUseCaseDeps } from '../dependencies';
import { ensureBotExecution } from './execution';
import { observeBot } from './observe';

export class BotConversationLifecycle {
  private busy = false;
  private after: string | undefined;
  constructor(private readonly deps: DevSessionUseCaseDeps, private readonly repo: BotConversationRepository, private readonly starts: AgentStartRepository, private readonly executions: AgentExecutionLifecycle) {}

  async sweep(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = await this.repo.list(this.after, 32);
      this.after = rows.length === 32 ? rows.at(-1)!.id : undefined;
      for (const row of rows) {
        try {
          const run = () => this.repo.withLock(row.taskId, () => this.tick(row.taskId));
          if (this.deps.projectWork) await this.deps.projectWork.runOrigin({ originKind: 'task', originKey: row.taskId, kind: 'agent-dispatch', reference: row.id, inputDigest: jsonHash({ conversationId: row.id }) }, run);
          else await run();
        } catch (error) { this.deps.logger.warn('Bot reconciliation deferred', { conversationId: row.id, error: error instanceof Error ? error.message : String(error) }); }
      }
    } finally { this.busy = false; }
  }

  private async tick(taskId: TaskId): Promise<void> {
    let current = await this.repo.get(taskId);
    if (!current) return;
    const parent = await this.deps.environments.getEnvironment(taskId);
    if (!parent || ['released', 'releasing', 'failed'].includes(parent.state)) return;
    current = await observeBot(this.deps, this.repo, this.starts, current);
    const operations = await this.repo.pending(taskId), control = operations.find((op) => op.kind !== 'message');
    if (control) { await this.control(current, control, operations); return; }
    const operation = operations.find((op) => op.kind === 'message');
    if (!operation || current.continuity === 'unavailable') return;
    try { await this.message(current, operation); }
    catch (error) {
      if (isPlatformError(error) && ['precondition', 'conflict', 'not_found', 'quota_exceeded', 'validation'].includes(error.kind)) {
        if (error.details?.['code'] === 'bot_execution_stopping') return;
        await this.repo.save({ ...(await this.repo.get(taskId))!, state: 'unavailable', continuity: 'unavailable', reason: error.message });
        await this.repo.updateOperation({ ...operation, closed: true, receipt: { ...operation.receipt, state: 'rejected', reason: error.message } });
        return;
      }
      throw error;
    }
  }

  private async message(current: BotConversation, operation: BotOperation): Promise<void> {
    const prepare = this.deps.environments.prepareBotContext;
    if (!prepare) throw precondition('Bot 原生上下文存储保护不可用');
    const storage = await prepare(current.taskId, current.id);
    if (!storage) return;
    current = { ...current, volumeUid: storage.volumeUid }; await this.repo.save(current);
    const existing = current.currentAgentId ? await this.starts.get(current.currentAgentId) : undefined;
    if (!operation.agentId && existing?.state === 'dispatched') {
      operation = { ...operation, agentId: existing.agentId }; await this.repo.updateOperation(operation);
    }
    if (operation.agentId && (await this.starts.get(operation.agentId))?.request.botContext?.requestId !== operation.requestId) {
      await this.send(current, operation); return;
    }
    const prepared = await ensureBotExecution(this.deps, this.repo, this.starts, current, operation);
    await this.executions.dispatch(prepared.start.agentId);
    const started = await this.starts.get(prepared.start.agentId);
    if (started?.state === 'dispatched') await this.repo.updateOperation({ ...prepared.operation, receipt: { ...operation.receipt, state: 'dispatched' } });
    else if (started?.state === 'ended') await this.repo.updateOperation({ ...prepared.operation, closed: true, receipt: { ...operation.receipt, state: 'rejected', reason: started.failure ?? '本轮已停止' } });
  }

  private async send(current: BotConversation, operation: BotOperation): Promise<void> {
    const execution = operation.agentId ? await this.repo.execution(operation.agentId) : undefined;
    if (!execution) throw precondition('消息所属执行不存在');
    const reconciling = operation.receipt.state === 'unknown';
    let receipt;
    if (operation.receipt.state === 'unknown') {
      receipt = await this.deps.runner.sendCommand(execution.executionTaskId, { id: `bot-receipt-${operation.requestId}`, type: 'botMessageReceipt', requestId: operation.requestId });
      // A missing receipt after an uncertain response is not proof that the process never received it.
      if (!receipt) return;
    } else {
      operation = { ...operation, receipt: { ...operation.receipt, state: 'unknown' } };
      await this.repo.updateOperation(operation);
      await this.repo.save({ ...current, state: 'unknown', reason: '正在确认消息是否已受理' });
      receipt = await this.deps.runner.sendCommand(execution.executionTaskId, { id: `bot-message-${operation.requestId}`, type: 'sendBotMessage', agentId: execution.agentId, requestId: operation.requestId, content: operation.content! });
    }
    const parsed = BotMessageReceiptSchema.parse(receipt);
    if (parsed.requestId !== operation.requestId || parsed.agentId !== execution.agentId || parsed.digest !== jsonHash({ type: 'message', content: operation.content })) throw precondition('Bot 受理回执与原消息不符');
    if (parsed.state !== 'accepted') return;
    await this.repo.updateOperation({ ...operation, receipt: { ...operation.receipt, state: 'dispatched' } });
    await this.repo.save({ ...current, state: reconciling && current.state === 'awaiting-input' ? 'awaiting-input' : 'running', reason: undefined });
  }

  private async control(current: BotConversation, operation: BotOperation, pending: BotOperation[]): Promise<void> {
    const start = operation.agentId ? await this.starts.get(operation.agentId) : undefined;
    if (start) {
      await this.starts.withLock(start.agentId, async () => { await this.executions.end((await this.starts.get(start.agentId))!, { cancelled: true }); });
      await this.executions.dispatch(start.agentId);
      const env = await this.deps.environments.getEnvironment(start.execution.taskId);
      if (env && env.native?.state !== 'finished') return;
      // A missing environment row cannot prove an admitted process stopped.
      if (!env && start.dispatchedAt) return;
    }
    for (const message of pending.filter((op) => op.kind === 'message')) await this.repo.updateOperation({ ...message, closed: true, receipt: { ...message.receipt, state: message.receipt.state === 'unknown' ? 'unknown' : 'rejected', reason: '本轮已停止，未自动重发' } });
    const fresh = operation.kind === 'fresh';
    const next: BotConversation = fresh ? { ...current, epoch: current.epoch + 1, nativeSessionId: undefined, currentAgentId: undefined, previousExecutionId: start?.execution.taskId ?? current.previousExecutionId, state: 'empty', continuity: 'unknown', reason: undefined }
      : { ...current, state: current.nativeSessionId ? 'paused' : 'unavailable', continuity: current.nativeSessionId ? 'available' : 'unavailable', reason: current.nativeSessionId ? undefined : '本轮尚未保存原生 session，需明确开启新上下文' };
    await this.repo.save(next);
    await this.repo.updateOperation({ ...operation, closed: true, receipt: { ...operation.receipt, epoch: next.epoch, state: 'dispatched' } });
  }
}
