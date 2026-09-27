import { expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import type { BusinessExecutionStore } from '../ports/businessExecutions';
import { businessIngestionWorker } from './businessIngestionWorker';

test('接收 worker 不重叠；stop 清除调度并等待已开始的数据库读取', async () => {
  let release!: () => void, reads = 0;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const unexpected = async (): Promise<never> => { throw new Error('unexpected'); };
  const store: BusinessExecutionStore = { consume: unexpected, expire: async () => 0, register: unexpected, ingest: unexpected, get: unexpected, list: unexpected, acknowledge: unexpected,
    pending: async () => { reads++; await blocked; return []; } };
  const worker = businessIngestionWorker({ store, connectedTasks: () => [], send: unexpected, logger: noopLogger });
  const first = worker.runOnce(), second = worker.runOnce();
  expect(first).toBe(second); await Promise.resolve(); expect(reads).toBe(1);
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  release(); await stop; expect(stopped).toBe(true);
  worker.start(); worker.start(); await worker.stop(); expect(reads).toBe(2);
});
