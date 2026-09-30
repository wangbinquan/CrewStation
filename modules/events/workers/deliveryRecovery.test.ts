import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { deliveryRecoveryWorker } from './deliveryRecovery';

test('恢复不重叠；停止等待本轮实际探针完成，不用计时器状态冒充退出',async () => {
  const entered = Promise.withResolvers<void>(),held = Promise.withResolvers<void>(); let calls = 0,exited = false;
  const worker = deliveryRecoveryWorker(async () => { calls += 1; entered.resolve(); await held.promise; });
  worker.start(); await entered.promise;
  const second = worker.runOnce(),stopping = worker.stop().then(() => { exited = true; });
  await Promise.resolve(); expect(calls).toBe(1); expect(exited).toBe(false);
  held.resolve(); await Promise.all([second,stopping]); expect(exited).toBe(true);
});
test('原始来源异常或敏感响应不进入恢复日志，故障后仍可重试',async () => {
  const messages: unknown[] = []; let calls = 0;
  const worker = deliveryRecoveryWorker(async () => { calls += 1; if (calls === 1) throw new Error('private-event-body-and-token'); },{ ...noopLogger,warn: (message,fields) => { messages.push({ message,fields }); } });
  await worker.runOnce(); await worker.runOnce(); expect(calls).toBe(2);
  expect(JSON.stringify(messages)).not.toContain('private-event-body-and-token'); expect(messages).toHaveLength(1); await worker.stop();
});
