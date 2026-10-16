import { BOT_RECEIPTS_MOUNT } from '@crewstation/contracts';
import type { StartAgentCommand } from '@crewstation/contracts';
import type { AgentSupervisor, AgentSupervisorDeps } from '../agents/supervisorContracts';
import { RunnerCommandError } from '../commandError';
import { BotReceipts } from './receipts';

/** Old interactive Agents keep their old contract. Bot commands require an explicit platform mount. */
export function withBotContext(inner: AgentSupervisor, deps: AgentSupervisorDeps): AgentSupervisor {
  const context = deps.botContext;
  if (!context) return { start: async (command) => {
    if (command.botContext) throw new RunnerCommandError('bot_context_unsupported', '此 Runner 未挂载 Bot 上下文');
    await inner.start(command);
  }, send: (id, text) => inner.send(id, text), cancel: (id) => inner.cancel(id), cancelAll: () => inner.cancelAll(), get size() { return inner.size; } };
  const journal = new BotReceipts(deps.botRoots?.receipts ?? BOT_RECEIPTS_MOUNT);
  const start = async (command: StartAgentCommand) => {
    const bot = command.botContext;
    if (!bot || bot.conversationId !== context.conversationId || bot.epoch !== context.epoch || command.launch.protocol !== 'opencode') throw new RunnerCommandError('bot_context_mismatch', '启动命令与私有 Bot 上下文不符');
    const receipt = await journal.dispatch(bot.requestId, command.agentId, { type: 'start', content: command.initialPrompt, compute: command.compute, revision: command.profileRevision, resumeSessionId: command.resumeSessionId ?? null }, () => inner.start(command));
    if (receipt.state !== 'accepted') throw new RunnerCommandError('bot_message_unknown', '消息执行状态尚未确认，不会重复发送');
  };
  return {
    start, send: async () => { throw new RunnerCommandError('bot_request_id_required', 'Bot 消息必须有稳定的请求标识'); },
    sendBot: (agentId, content, requestId) => journal.dispatch(requestId, agentId, { type: 'message', content }, () => inner.send(agentId, content)),
    botReceipt: (requestId) => { const receipt = journal.get(requestId); return receipt?.state === 'dispatching' ? { ...receipt, state: 'unknown' } : receipt; },
    botContextInfo: () => ({ version: 1, conversationId: context.conversationId, epoch: context.epoch, volumeUid: context.volumeUid }),
    cancel: (id) => inner.cancel(id),
    cancelAll: async () => { await inner.cancelAll(); journal.close(); },
    get size() { return inner.size; },
  };
}
