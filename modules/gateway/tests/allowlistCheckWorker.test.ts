import { expect, test } from 'bun:test';
import type { Logger } from '@crewstation/kernel';
import { allowlistCheckWorker } from '../workers/allowlistCheck';

test('放行表核对工作器：启动即跑一次、此后按周期；失败只记告警，不打断节奏', async () => {
  const seen: string[] = [];
  const logger: Logger = { debug: () => undefined, info: () => undefined, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => logger };
  let calls = 0;
  const worker = allowlistCheckWorker(async () => { calls += 1; if (calls === 1) throw new Error('库暂时不可用'); }, logger, 10);
  worker.start();
  const deadline = Date.now() + 2_000;
  while (calls < 2 && Date.now() < deadline) await Bun.sleep(5);
  await worker.stop();
  expect(calls).toBeGreaterThanOrEqual(2);
  expect(seen).toEqual(['allowlist check failed']);
});
