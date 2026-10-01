import { expect, test } from 'bun:test';
import type { Logger } from '@crewstation/kernel';
import { gatewayProcessRecoveryWorker, identityTombstoneWorker } from '../workers/identityTombstones';

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
test('原网关回调恢复工作器失败后继续恢复，停止等待实际执行结束，告警不暴露原始错误或凭据', async () => {
  const seen: string[] = [], entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>(); let calls = 0, recovered = false;
  const logger: Logger = { debug: () => undefined, info: () => undefined, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => logger };
  const worker = gatewayProcessRecoveryWorker(async () => {
    calls += 1; if (calls === 1) throw new Error('private-origin-credential');
    entered.resolve(); await released.promise; recovered = true;
  }, logger, 10);
  worker.start(); await entered.promise;
  let stopped = false; const stopping = worker.stop().then(() => { stopped = true; });
  expect(stopped).toBe(false); expect(recovered).toBe(false);
  released.resolve(); await stopping;
  expect(calls).toBe(2); expect(recovered).toBe(true); expect(seen).toEqual(['original gateway process recovery unavailable']);
});
