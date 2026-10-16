import type { AgentEvent, RunnerCommand, TaskId } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { createTestDatabase } from '@crewstation/testkit';
import { drizzleBotConversations } from '../adapters/persistence/bot/repository';
import { botConversationUseCases } from '../application/bot/conversations';
import { BotConversationLifecycle } from '../application/bot/lifecycle';
import { devSessionMigrations } from '../wiring';
import { agentExecutionFixture } from './agentExecutionFixture';
import { fakeComputeCatalog } from './computeFixture';
import { workspaceActor, workspaceTask } from './workspaceFixture';

export async function botConversationFixture() {
  const f = agentExecutionFixture(), db = await createTestDatabase([devSessionMigrations]), repo = drizzleBotConversations(db.db);
  const api = botConversationUseCases(f.deps, repo), lifecycle = new BotConversationLifecycle(f.deps, repo, f.starts, f.lifecycle);
  const state = { volume: true, loseReply: false, receipts: new Map<string, unknown>() };
  f.deps.compute = fakeComputeCatalog(() => [{ name: 'bot', protocol: 'opencode', isDefault: true }]);
  f.deps.environments.prepareBotContext = async () => state.volume ? { volumeUid: 'original-private-volume' } : undefined;
  const send = f.deps.runner.sendCommand;
  f.deps.runner.sendCommand = async (taskId, command) => {
    if (command.type === 'botContextInfo') { const conversation = (await repo.get(workspaceTask))!; return { version: 1, conversationId: conversation.id, epoch: conversation.epoch, volumeUid: conversation.volumeUid }; }
    if (command.type === 'sendBotMessage') {
      f.routed.push({ taskId, command });
      const receipt = { requestId: command.requestId, agentId: command.agentId, digest: jsonHash({ type: 'message', content: command.content }), state: 'accepted' };
      state.receipts.set(command.requestId, receipt);
      if (state.loseReply) throw new Error('response lost');
      return receipt;
    }
    if (command.type === 'botMessageReceipt') return state.receipts.get(command.requestId) ?? null;
    return send(taskId, command);
  };
  const current = async () => (await api.getBot(workspaceActor, workspaceTask)).conversation!;
  const tick = async () => { await f.lifecycle.sweep(); await lifecycle.sweep(); };
  const connect = async () => { const bot = await current(); f.connect(bot.execution!.executionTaskId); await tick(); };
  const emit = async (patch: Partial<AgentEvent>) => {
    const bot = await current(), target = bot.execution!;
    f.emit(target.executionTaskId, { kind: 'agent', event: { agentId: target.agentId, seq: 1, at: new Date().toISOString(), type: 'status', ...patch } }); await tick();
  };
  const message = async (content: string) => api.sendBotMessage(workspaceActor, workspaceTask, { content, requestId: crypto.randomUUID(), expectedRevision: (await current())?.revision ?? 0 });
  const starts = () => f.routed.filter((row): row is { taskId: TaskId; command: Extract<RunnerCommand, { type: 'startAgent' }> } => row.command.type === 'startAgent');
  const stopped = async () => { const bot = await current(), env = f.environments.get(bot.execution!.executionTaskId)!; env.state = 'released'; env.native!.state = 'finished'; await tick(); };
  return { ...f, db, repo, botApi: api, botLifecycle: lifecycle, botState: state, current, tick, connectBot: connect, emitBot: emit, message, startCommands: starts, stopped };
}
