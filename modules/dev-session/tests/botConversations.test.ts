import { afterEach, describe, expect, test } from 'bun:test';
import { forbidden } from '@crewstation/kernel';
import { testDatabaseAvailable } from '@crewstation/testkit';
import { botConversationUseCases } from '../application/bot/conversations';
import { drizzleBotConversations } from '../adapters/persistence/bot/repository';
import { botConversationFixture } from './botConversationFixture';
import { workspaceActor as actor, workspaceTask as task } from './workspaceFixture';

const available = await testDatabaseAvailable();
let f: Awaited<ReturnType<typeof botConversationFixture>> | undefined;
afterEach(async () => { await f?.db.drop(); f = undefined; });
describe.skipIf(!available)('durable default Bot conversation', () => {
  test('read is side-effect free; concurrent first sends and repeated request IDs have one durable acceptance', async () => {
    f = await botConversationFixture();
    expect(await f.botApi.getBot(actor, task)).toEqual({ conversation: null }); expect(f.starts.rows.size).toBe(0);
    const input = { requestId: crypto.randomUUID(), expectedRevision: 0, content: 'first' };
    const other = botConversationUseCases(f.deps, drizzleBotConversations(f.db.db));
    const receipts = await Promise.all([f.botApi.sendBotMessage(actor, task, input), other.sendBotMessage(actor, task, input)]);
    expect(receipts[0]).toEqual(receipts[1]); expect((await f.current()).revision).toBe(1);
    await expect(other.sendBotMessage(actor, task, { ...input, content: 'changed' })).rejects.toMatchObject({ kind: 'conflict' });
    await expect(other.sendBotMessage(actor, task, { ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({ kind: 'conflict' });
    f.botState.volume = false; await f.tick(); expect(f.starts.rows.size).toBe(0);
    f.botState.volume = true; await f.tick(); await f.connectBot();
    expect(f.startCommands()).toHaveLength(1); expect(f.startCommands()[0]!.command.botContext?.conversationId).toBe(receipts[0]!.conversationId);
  });
  test('ordinary turns keep Agent/native identity; interrupted execution waits for physical finish before same-session resume', async () => {
    f = await botConversationFixture(); await f.message('remember random marker'); await f.tick(); await f.connectBot();
    await f.emitBot({ type: 'session', sessionId: 'ses_original' }); await f.emitBot({ type: 'status', status: 'waiting' });
    const original = await f.current();
    await f.message('next turn'); await f.tick();
    expect(f.startCommands()).toHaveLength(1);
    expect(f.routed.filter((row) => row.command.type === 'sendBotMessage')).toHaveLength(1);
    const running = await f.current();
    await f.botApi.interruptBot(actor, task, { requestId: crypto.randomUUID(), expectedRevision: running.revision, expectedExecutionId: running.execution!.executionTaskId });
    await f.tick(); expect((await f.current()).state).toBe('stopping');
    await expect(f.message('too early')).rejects.toMatchObject({ kind: 'precondition' });
    await f.stopped(); expect((await f.current()).state).toBe('paused');
    await f.message('recall random marker'); f.botState.volume = false; await f.tick();
    // RFC-041 live cold resume: observing the ended old Agent must not mark its replacement paused.
    expect((await f.current()).state).toBe('preparing');
    expect((await f.repo.execution(original.execution!.agentId))?.state).toBe('paused');
    await expect(f.message('another page while the replacement starts')).rejects.toMatchObject({ kind: 'precondition' });
    f.botState.volume = true; await f.tick(); expect((await f.current()).state).toBe('preparing');
    await f.connectBot();
    const resumed = await f.current(), command = f.startCommands().at(-1)!.command;
    expect(resumed.conversationId).toBe(original.conversationId); expect(resumed.epoch).toBe(1);
    expect(resumed.execution?.agentId).not.toBe(original.execution?.agentId);
    expect(command.resumeSessionId).toBe('ses_original'); expect(command.botContext?.epoch).toBe(1);
    expect(f.inputs.at(-1)?.botContext).toMatchObject({ mode: 'existing', expectedPreviousExecutionId: original.execution!.executionTaskId });
    const history = await f.botApi.botHistory(actor, task, { limit: 1 });
    expect(history.items).toHaveLength(1); expect(history.next).toBe(resumed.execution!.agentId);
    expect((await f.botApi.botHistory(actor, task, { limit: 1, after: history.next })).items[0]?.agentId).toBe(original.execution?.agentId);
    // An already persisted stale preparation label must also use the finished environment's actual state.
    const oldExecution = (await f.repo.execution(original.execution!.agentId))!;
    await f.repo.putExecution({ ...oldExecution, state: 'preparing' });
    expect((await f.botApi.botHistory(actor, task, { limit: 1, after: history.next })).items[0]?.state).toBe('paused');
    expect((await f.repo.execution(oldExecution.agentId))?.state).toBe('preparing'); // Read projection, no mutation.
    const oldEnvironment = f.environments.get(oldExecution.executionTaskId)!;
    oldEnvironment.native!.state = 'cleaning';
    expect((await f.botApi.botHistory(actor, task, { limit: 1, after: history.next })).items[0]?.state).toBe('preparing');
    oldEnvironment.native!.state = 'finished';
    await f.repo.putExecution({ ...oldExecution, state: 'preparing', nativeSessionId: undefined });
    expect((await f.botApi.botHistory(actor, task, { limit: 1, after: history.next })).items[0]?.state).toBe('unavailable');
  });
  test('lost response reconciles the original receipt and never resends the model message', async () => {
    f = await botConversationFixture(); await f.message('first'); await f.tick(); await f.connectBot();
    await f.emitBot({ type: 'session', sessionId: 'ses_original' }); await f.emitBot({ type: 'status', status: 'waiting' });
    f.botState.loseReply = true; const receipt = await f.message('second'); await f.tick();
    expect((await f.current()).state).toBe('unknown');
    f.botState.loseReply = false; await f.tick();
    expect((await f.repo.operation(task, receipt.requestId))?.receipt.state).toBe('dispatched');
    expect(f.routed.filter((row) => row.command.type === 'sendBotMessage')).toHaveLength(1);
  });
  test('parent-driven cleanup becomes resumable after actual finish without a user stop operation', async () => {
    f = await botConversationFixture(); await f.message('original context'); await f.tick(); await f.connectBot();
    await f.emitBot({ type: 'session', sessionId: 'ses_original' }); await f.emitBot({ type: 'status', status: 'waiting' });
    const current = await f.current(), execution = current.execution!, start = f.starts.rows.get(execution.agentId)!;
    await f.lifecycle.end(start, { cancelled: true }); await f.tick();
    expect((await f.current()).state).toBe('stopping');
    expect((await f.repo.pending(task)).some(op => op.kind !== 'message')).toBe(false);
    // The real parent-rebuild cleanup finished, but the observed stopping state was mistaken for a permanent user intent.
    await f.stopped(); expect((await f.current()).state).toBe('paused');
    expect((await f.current()).nativeSessionId).toBe('ses_original');
    await f.message('resume after parent rebuild'); await f.tick(); await f.connectBot();
    expect(f.startCommands().at(-1)!.command.resumeSessionId).toBe('ses_original');
  });
  test('fresh context is explicit and keeps history; missing context or different native ID does not silently resume', async () => {
    f = await botConversationFixture(); await f.message('first'); await f.tick(); await f.connectBot();
    await f.emitBot({ type: 'session', sessionId: 'ses_original' });
    const current = await f.current();
    const fresh = { requestId: crypto.randomUUID(), expectedRevision: current.revision, fresh: true as const };
    await f.botApi.freshBotContext(actor, task, fresh); await f.tick(); expect((await f.current()).epoch).toBe(1);
    await f.stopped(); expect((await f.current()).epoch).toBe(2);
    expect((await f.current()).nativeSessionId).toBeUndefined(); expect((await f.botApi.botHistory(actor, task, { limit: 30 })).items).toHaveLength(1);
    expect((await f.botApi.freshBotContext(actor, task, fresh)).epoch).toBe(2);
    await f.message('new context'); await f.tick(); await f.connectBot();
    expect(f.startCommands().at(-1)!.command.resumeSessionId).toBeUndefined();
    await f.emitBot({ type: 'session', sessionId: 'ses_fresh' }); await f.emitBot({ type: 'session', sessionId: 'ses_wrong' });
    expect((await f.current()).continuity).toBe('unavailable');
    await expect(f.message('must not start empty context')).rejects.toMatchObject({ kind: 'precondition' });
  });
  test('view/develop authorization and stream access remain enforced', async () => {
    f = await botConversationFixture();
    f.deps.authorizer.authorize = async () => { throw forbidden(); };
    await expect(f.botApi.getBot(actor, task)).rejects.toMatchObject({ kind: 'forbidden' });
    await expect(f.message('denied')).rejects.toMatchObject({ kind: 'forbidden' });
    f.deps.authorizer.authorize = async () => {}; f.deps.environments.canOpenStream = async () => false;
    await expect(f.botApi.botHistory(actor, task, { limit: 30 })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(f.starts.rows.size).toBe(0);
  });
});
