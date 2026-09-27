import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { businessMessageDigestInput } from '@crewstation/contracts';
import { noopLogger } from '@crewstation/kernel';
import type { AgentEvent } from '@crewstation/contracts';
import { ExecutionJournal } from '../src/exec/executionJournal';
import { BusinessAgentSupervisor } from '../src/agents/businessAgentSupervisor';
import { businessMessages } from '../src/agents/businessMessages';
import { createEventQueue } from '../src/agents/eventQueue';

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of cleanups.splice(0).reverse()) await dispose(); });
test('message write happens once, never persists text, and uncertain old incarnation is queried without resend', async () => {
  const root = await mkdtemp(join(tmpdir(), 'business-messages-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const limits = { outputBytes: 4096, spoolBytes: 8192, eventBytes: 2048 }, journal = new ExecutionJournal(root, crypto.randomUUID(), limits); cleanups.push(() => journal.close());
  const agents = new BusinessAgentSupervisor(journal, noopLogger), events = createEventQueue<AgentEvent>(); let sent = 0, sentResolve!: () => void;
  const delivered = new Promise<void>((resolve) => { sentResolve = resolve; });
  const executionId = Bun.randomUUIDv7();
  agents.start({ executionId, attempt: 1, payloadDigest: 'a'.repeat(64) }, async () => ({ events, send: async () => { sent++; await delivered; }, cancel: async () => {} }));
  await Promise.resolve();
  const commands = businessMessages(journal, agents), nonce = 'b'.repeat(64), content = 'private user message';
  const input = { id: 'wire', type: 'sendBusinessMessage' as const, executionId, messageId: Bun.randomUUIDv7(), attempt: 1, incarnation: journal.incarnation, content, digestNonce: nonce,
    payloadDigest: new Bun.CryptoHasher('sha256').update(businessMessageDigestInput(content, nonce)).digest('hex') };
  expect(await commands.sendMessage(input)).toMatchObject({ phase: 'sending' });
  await commands.sendMessage(input); expect(sent).toBe(1);
  await expect(commands.sendMessage({ ...input, content: 'different' })).rejects.toMatchObject({ code: 'idempotency_conflict' });
  const reopened = new ExecutionJournal(root, crypto.randomUUID(), limits); cleanups.push(() => reopened.close());
  const recovered = businessMessages(reopened, new BusinessAgentSupervisor(reopened, noopLogger));
  expect(await recovered.sendMessage(input)).toMatchObject({ phase: 'unknown' }); expect(sent).toBe(1);
  expect(JSON.stringify(await recovered.getMessage({ id: 'read', type: 'getBusinessMessage', executionId, messageId: input.messageId }))).not.toContain(content);
  sentResolve(); await delivered; await Promise.resolve(); await Promise.resolve();
  expect(journal.messages.get(executionId, input.messageId)).toMatchObject({ phase: 'delivered' });
  events.push({ agentId: executionId, seq: 1, at: new Date().toISOString(), type: 'cancelled' }); events.close(); await agents.settled(executionId);
});
