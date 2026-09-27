import { businessMessageDigestInput } from '@crewstation/contracts';
import type { CommandOf } from '../commandDispatcher';
import { RunnerCommandError } from '../commandError';
import type { ExecutionJournal } from '../exec/executionJournal';
import type { BusinessAgentSupervisor } from './businessAgentSupervisor';

export function businessMessages(journal: ExecutionJournal, agents: BusinessAgentSupervisor) {
  const pending = new Set<Promise<void>>();
  const get = (executionId: string, messageId: string) => {
    const receipt = journal.messages.get(executionId, messageId);
    if (!receipt) throw new RunnerCommandError('message_not_found', '消息尚未登记');
    return receipt;
  };
  return {
    drainMessages: async () => { await Promise.allSettled([...pending]); },
    getMessage: async (input: CommandOf<'getBusinessMessage'>) => get(input.executionId, input.messageId),
    sendMessage: async (input: CommandOf<'sendBusinessMessage'>) => {
      const digest = new Bun.CryptoHasher('sha256').update(businessMessageDigestInput(input.content, input.digestNonce)).digest('hex');
      if (digest !== input.payloadDigest) throw new RunnerCommandError('idempotency_conflict', '消息参数摘要不同');
      const previous = journal.messages.get(input.executionId, input.messageId);
      if (previous) return journal.messages.reserve(input).receipt;
      const execution = journal.get(input.executionId);
      if (!execution || execution.attempt !== input.attempt || input.incarnation !== journal.incarnation || execution.incarnation !== input.incarnation) throw new RunnerCommandError('execution_incarnation_changed', '原 Agent 身份已不可证明');
      if (execution.phase !== 'running' || !agents.owns(input.executionId)) throw new RunnerCommandError('agent_not_running', 'Agent 当前不能接收消息');
      const reserved = journal.messages.reserve(input);
      if (reserved.created) {
        const delivery = Promise.resolve().then(() => agents.send(input.executionId, input.content)).then(() => journal.messages.settle(input, 'delivered'), (error: unknown) => {
          const code = error instanceof RunnerCommandError ? error.code : 'message_delivery_unknown';
          const notSent = ['agent_preparing', 'agent_not_running', 'agent_not_interactive'].includes(code);
          journal.messages.settle(input, notSent ? 'failed' : 'unknown', code);
        }).catch(() => { /* The durable sending record becomes unknown on recovery; never repeat the CLI write. */ }).finally(() => { pending.delete(delivery); });
        pending.add(delivery);
      }
      return reserved.receipt;
    },
  };
}
