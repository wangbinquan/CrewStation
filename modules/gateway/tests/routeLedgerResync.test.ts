import { expect, test } from 'bun:test';
import type { Logger } from '@crewstation/kernel';
import { routeLedgerResyncWorker } from '../workers/routeLedgerResync';

test('路由补投影工作器：启动即跑一次、此后按周期；失败只记告警；重复启动不叠加；停止时等本轮跑完', async () => {
  let calls = 0;
  const seen: string[] = [];
  const logger: Logger = { debug: () => undefined, info: (msg) => { seen.push(msg); }, warn: (msg) => { seen.push(msg); }, error: () => undefined, child: () => logger };
  const worker = routeLedgerResyncWorker(async () => { calls += 1; if (calls === 2) throw new Error('台账暂时不可用'); return 3; }, logger, 20);
  worker.start(); worker.start();
  const deadline = Date.now() + 2_000;
  while (calls < 3 && Date.now() < deadline) await Bun.sleep(5);
  await worker.stop();
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(seen).toContain('resource ledger routes resynced'); expect(seen).toContain('resource ledger route resync failed');
});
