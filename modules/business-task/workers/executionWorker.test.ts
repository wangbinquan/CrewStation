import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { executionWorker } from './executionWorker';

test('恢复 worker 不重叠派发，关闭等待在途一轮完成，重启可以继续', async () => {
  let calls = 0, finish!: () => void;
  const blocked = new Promise<void>((resolve) => { finish = resolve; });
  const worker = executionWorker(async () => { calls++; await blocked; return 1; }, noopLogger);
  worker.start(); worker.start();
  try {
    await Bun.sleep(1050);
    expect(calls).toBe(1);
    let stopped = false;
    const stopping = worker.stop().then(() => { stopped = true; });
    await Bun.sleep(5); expect(stopped).toBe(false);
    finish(); await stopping; expect(stopped).toBe(true);
    worker.start(); await worker.stop(); expect(calls).toBe(2);
  } finally { finish(); await worker.stop(); }
});
