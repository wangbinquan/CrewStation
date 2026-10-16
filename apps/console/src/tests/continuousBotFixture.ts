import { BotConversationDtoSchema, SendBotMessageRequestSchema } from '@crewstation/contracts';
import type { BotConversationDto, BotExecutionDto, SendBotMessageRequest } from '@crewstation/contracts';
import { activityTaskId, activityTime } from './agentActivityFixture';
import { historicalConversationFixture } from './historicalConversationFixture';

export const botAgentId = '01a0bf5d-8f4b-7111-8111-111111111114';
export const botConversationId = '01a0bf5d-8f4b-7111-8111-111111111113';
export function continuousBotFixture() {
  const f = historicalConversationFixture(), base = globalThis.fetch;
  const state: { conversation: BotConversationDto | null; history: BotExecutionDto[] } = { conversation: null, history: [] };
  const messages: Array<{ input: SendBotMessageRequest; resolve: (response: Response) => void }> = [];
  const controls: Array<{ type: string; input: unknown }> = [];
  globalThis.fetch = (async (raw, init) => {
    const path = new URL(String(raw), 'http://localhost').pathname;
    if (path.endsWith('/bot')) return Response.json({ conversation: state.conversation });
    if (path.endsWith('/bot/history')) return Response.json({ items: [...state.history].reverse() });
    if (path.endsWith('/bot/messages')) return new Promise<Response>(resolve => messages.push({ input: SendBotMessageRequestSchema.parse(JSON.parse(String(init?.body))), resolve }));
    if (/\/bot\/(interrupt|context)$/.test(path)) {
      const input = JSON.parse(String(init?.body)); controls.push({ type: path.split('/').at(-1)!, input });
      return Response.json({ requestId: input.requestId, conversationId: botConversationId, revision: 2, epoch: 1, state: 'accepted' }, { status: 202 });
    }
    return base(raw, init);
  }) as typeof fetch;
  const finishMessage = (index: number, fail = false) => {
    const message = messages[index]!;
    if (fail) { message.resolve(Response.json({ error: 'unavailable', message: '消息回执尚未确认' }, { status: 503 })); return; }
    state.conversation = BotConversationDtoSchema.parse({ conversationId: botConversationId, taskId: activityTaskId, revision: message.input.expectedRevision + 1, epoch: 1,
      state: 'preparing', continuity: 'unknown', computeName: message.input.compute?.kind === 'profile' && message.input.compute.profileId.endsWith('222222222222') ? 'fast' : 'standard', profileRevision: 1, protocol: 'opencode', execution: { agentId: botAgentId, executionTaskId: activityTaskId, epoch: 1, state: 'preparing', initialPrompt: message.input.content, createdAt: activityTime } });
    state.history = [state.conversation.execution!];
    message.resolve(Response.json({ requestId: message.input.requestId, conversationId: botConversationId, revision: state.conversation.revision, epoch: 1, state: 'accepted' }, { status: 202 }));
  };
  return { ...f, bot: state, botMessages: messages, controls, finishMessage,
    restore: () => { for (const [i] of messages.entries()) finishMessage(i, true); f.restore(); } };
}
