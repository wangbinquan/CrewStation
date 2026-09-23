import { expect, test } from 'bun:test';
import type { Logger } from '@crewstation/kernel';
import { rateLimitLedgerResyncWorker } from '../workers/rateLimitLedgerResync';

test('限流策略补投影工作器：写了才记一条，没有可写的不记；失败只记告警', async () => {
  const seen: string[] = [];
  const logger: Logger = { debug: () => undefined, info: (msg, fields) => { seen.push(`${msg} ${JSON.stringify(fields)}`); }, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => logger };
  const results: Array<number | Error> = [3, 0, new Error('台账暂时不可用')];
  let calls = 0;
  const worker = rateLimitLedgerResyncWorker(async () => { const next = results[calls++] ?? 0; if (next instanceof Error) throw next; return next; }, logger, 10);
  worker.start();
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) await Bun.sleep(5);
  await worker.stop();
  expect(seen).toEqual(['resource ledger rate limits resynced {"synced":3}', 'resource ledger rate limit resync failed']);
});
