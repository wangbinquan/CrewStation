import { expect, test } from 'bun:test';
import type { Logger } from '@crewstation/kernel';
import { identityTombstoneWorker } from '../workers/identityTombstones';

test('墓碑清理工作器：删了才记一条，没有可删的不记；失败只记告警', async () => {
  const seen: string[] = [];
  const logger: Logger = { debug: () => undefined, info: (msg, fields) => { seen.push(`${msg} ${JSON.stringify(fields)}`); }, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => logger };
  const results: Array<number | Error> = [3, 0, new Error('库暂时不可用')];
  let calls = 0;
  const worker = identityTombstoneWorker(async () => { const next = results[calls++] ?? 0; if (next instanceof Error) throw next; return next; }, logger, 10);
  worker.start();
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) await Bun.sleep(5);
  await worker.stop();
  expect(seen).toEqual(['pod identity tombstones purged {"purged":3}', 'pod identity tombstone purge failed']);
});
