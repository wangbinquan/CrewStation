import { randomBytes } from 'node:crypto';
import { businessMessageDigestInput, BusinessMessageReceiptSchema, BusinessExecutionInfoSchema } from '@crewstation/contracts';
import type { RunnerBusinessMessageReceipt } from '@crewstation/contracts';
import { conflict, isPlatformError, jsonHash, newResourceId, notFound, precondition } from '@crewstation/kernel';
import type { BusinessExecutionApi } from '../../api/executionApi';
import type { ExecutionMessage } from '../../domain/executionMessage';
import { messageView } from '../../domain/executionMessage';
import type { ExecutionAgentPlan } from '../../domain/executionAgent';
import type { BusinessExecutionDeps } from './dependencies';
import { executionSource } from './source';
import { businessExecutionWork } from './deletion/projectWork';

export function executionMessageUseCases(deps: BusinessExecutionDeps): Pick<BusinessExecutionApi, 'sendMessage'> & { progressMessage(): Promise<number> } {
  const source = executionSource(deps);
  const progress = async (id?: string) => {
    const claim = await deps.messages.claim(newResourceId(), id);
    if (!claim) return 0;
    await businessExecutionWork(deps, { serviceId: claim.serviceId, taskId: claim.taskId, kind: 'message', reference: claim.id, revision: claim.revision }, (scoped) => dispatchMessage(scoped, claim)); return 1;
  };
  return {
    sendMessage: async (caller, taskId, subtaskId, input) => {
      const context = await source(caller);
      if (!await deps.operations.forTask(context.serviceId, taskId)) throw notFound('业务任务', taskId);
      const digest = jsonHash({ expectedAttempt: input.expectedAttempt, content: input.content });
      const authorization = { source: context.authority, ...(input.fence ? { fence: input.fence } : {}) };
      let operation = await deps.messages.find(context.serviceId, taskId, subtaskId, input.requestKey);
      if (operation) {
        if (operation.requestDigest !== digest) throw conflict('消息幂等键参数不同', { code: 'idempotency_conflict' });
        if (input.fence) operation = await deps.messages.adopt(operation, authorization);
      } else {
        const subtask = await deps.subtasks.get(context.serviceId, taskId, subtaskId);
        if (!subtask) throw notFound('业务子任务', subtaskId);
        if (subtask.view.kind !== 'agent' || !subtask.runtimeTaskId || !subtask.incarnation) throw precondition('该执行不能接收 Agent 消息', { code: 'agent_not_running' });
        const plan = JSON.parse(await deps.cipher.open(subtask.sealedPayload)) as ExecutionAgentPlan;
        if (plan.request.mode !== 'interactive') throw precondition('oneshot Agent 不接受追加消息', { code: 'agent_not_interactive' });
        const nonce = randomBytes(32).toString('hex');
        operation = await deps.messages.reserve({ id: newResourceId(), serviceId: context.serviceId, taskId, subtaskId, requestKey: input.requestKey, requestDigest: digest,
          executionId: subtask.view.executionId, runtimeTaskId: subtask.runtimeTaskId, attempt: input.expectedAttempt, incarnation: subtask.incarnation, epoch: subtask.epoch,
          payloadDigest: new Bun.CryptoHasher('sha256').update(businessMessageDigestInput(input.content, nonce)).digest('hex'), sealedPayload: await deps.cipher.seal(JSON.stringify({ content: input.content, nonce })),
        }, authorization);
      }
      if (operation.state === 'pending') await progress(operation.id);
      return messageView((await deps.messages.get(operation.id))!);
    },
    progressMessage: () => progress(),
  };
}
async function dispatchMessage(deps: BusinessExecutionDeps, claim: ExecutionMessage): Promise<void> {
  try {
    const subtask = await deps.subtasks.get(claim.serviceId, claim.taskId, claim.subtaskId);
    const terminal = !subtask || ['succeeded', 'failed', 'cancelled'].includes(subtask.view.state);
    if (!claim.dispatched && (terminal || subtask?.view.cancelRequestedAt)) { await deps.messages.settle(claim, 'failed', 'message_not_sent'); return; }
    if (claim.dispatched) {
      try {
        const receipt = BusinessMessageReceiptSchema.parse(await deps.runner.sendCommand(claim.runtimeTaskId, { id: newResourceId(), type: 'getBusinessMessage', executionId: claim.executionId, messageId: claim.id }));
        await acceptMessage(deps, claim, receipt, terminal); return;
      } catch (error) { if (!isPlatformError(error) || error.details?.code !== 'message_not_found') throw error; }
    }
    const info = BusinessExecutionInfoSchema.parse(await deps.runner.sendCommand(claim.runtimeTaskId, { id: newResourceId(), type: 'businessExecutionInfo' }));
    if (info.incarnation !== claim.incarnation) { await deps.messages.settle(claim, terminal ? 'failed' : 'unknown', 'message_delivery_unknown'); return; }
    if (!await deps.messages.checkpoint(claim)) { await deps.messages.settle(claim, 'pending'); return; }
    const payload = JSON.parse(await deps.cipher.open(claim.sealedPayload)) as { content: string; nonce: string };
    const receipt = BusinessMessageReceiptSchema.parse(await deps.runner.sendCommand(claim.runtimeTaskId, { id: newResourceId(), type: 'sendBusinessMessage',
      executionId: claim.executionId, attempt: claim.attempt, messageId: claim.id, incarnation: claim.incarnation, payloadDigest: claim.payloadDigest, digestNonce: payload.nonce, content: payload.content }));
    await acceptMessage(deps, claim, receipt, terminal);
  } catch { await deps.messages.settle(claim, 'unknown', 'message_delivery_unknown'); }
}
async function acceptMessage(deps: BusinessExecutionDeps, claim: ExecutionMessage, receipt: RunnerBusinessMessageReceipt, terminal: boolean) {
  if (receipt.executionId !== claim.executionId || receipt.messageId !== claim.id || receipt.attempt !== claim.attempt || receipt.incarnation !== claim.incarnation || receipt.payloadDigest !== claim.payloadDigest) throw new Error('message identity conflict');
  const state = receipt.phase === 'delivered' ? 'succeeded' : receipt.phase === 'failed' ? 'failed' : terminal ? 'failed' : receipt.phase === 'sending' ? 'awaiting' : 'unknown';
  await deps.messages.settle(claim, state, receipt.errorCode ?? (receipt.phase === 'unknown' || (terminal && receipt.phase === 'sending') ? 'message_delivery_unknown' : undefined));
}
