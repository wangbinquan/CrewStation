import { afterEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotReceipts } from './receipts';
import { jsonHash } from '@crewstation/kernel';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });
async function directory() { const root = await mkdtemp(join(tmpdir(), 'cs-bot-receipts-')); roots.push(root); return root; }
test('same message has one durable dispatch across concurrent retries and reopened journals', async () => {
  const root = await directory(), journal = new BotReceipts(root), id = crypto.randomUUID(); let sent = 0;
  const send = async () => { sent++; await Bun.sleep(10); };
  const results = await Promise.all([journal.dispatch(id, 'agent', 'prompt', send), journal.dispatch(id, 'agent', 'prompt', send)]);
  expect(sent).toBe(1); expect(results[0]).toEqual(results[1]); expect(results[0]?.state).toBe('accepted');
  journal.close(); const reopened = new BotReceipts(root);
  expect((await reopened.dispatch(id, 'agent', 'prompt', send)).state).toBe('accepted'); expect(sent).toBe(1);
  await expect(reopened.dispatch(id, 'agent', 'different', send)).rejects.toThrow('不同内容');
  reopened.close();
});
test('response loss or crash after dispatch intent remains unknown and never invokes model twice', async () => {
  const root = await directory(), journal = new BotReceipts(root), id = crypto.randomUUID(); let sent = 0;
  expect((await journal.dispatch(id, 'agent', 'prompt', async () => { sent++; throw new Error('response lost'); })).state).toBe('unknown');
  await journal.dispatch(id, 'agent', 'prompt', async () => { sent++; }); expect(sent).toBe(1); journal.close();
  const crashed = crypto.randomUUID(), db = new Database(join(root, 'receipts.sqlite'));
  db.query('INSERT INTO receipts VALUES (?,?)').run(crashed, JSON.stringify({ requestId: crashed, agentId: 'agent', digest: jsonHash('prompt'), state: 'dispatching' })); db.close();
  const resumed = new BotReceipts(root);
  expect((await resumed.dispatch(crashed, 'agent', 'prompt', async () => { sent++; })).state).toBe('unknown');
  expect(sent).toBe(1); resumed.close();
});
