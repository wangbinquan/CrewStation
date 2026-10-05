import { expect, test } from 'bun:test';
import { newResourceId, noopLogger } from '@crewstation/kernel';
import { ProjectIdSchema, TaskIdSchema, type DevelopmentUsageRegistration } from '@crewstation/contracts';
import type { DevelopmentUsageStore } from '../ports/developmentUsage';
import { developmentUsageWorker } from './developmentUsageWorker';
function developmentRegistration(): DevelopmentUsageRegistration {
  const runtimeTaskId = TaskIdSchema.parse(newResourceId());
  return { runtimeTaskId, key: { executionId: runtimeTaskId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) }, podUid: 'pod', profileId: newResourceId(), profileRevision: 1, identity: { sourceKind: 'development-agent', projectId: ProjectIdSchema.parse(newResourceId()), taskId: TaskIdSchema.parse(newResourceId()), executionId: runtimeTaskId, executionGeneration: 1, agentId: newResourceId() } };
}

const unexpected = async (): Promise<never> => { throw new Error('unexpected'); };
const storeWith = (pending: DevelopmentUsageStore['pending']): DevelopmentUsageStore => ({ lookup: unexpected, register: unexpected, get: unexpected, ingest: unexpected, acknowledgeRunner: unexpected, verifyRunnerCopy: unexpected, nativePage: unexpected, requestDrain: unexpected, unavailable: unexpected, pending });

test('development worker does not overlap and stop waits for its active PG copy', async () => {
  let release!: () => void, reads = 0; const blocked = new Promise<void>((done) => { release = done; });
  const worker = developmentUsageWorker({ store: storeWith(async () => { reads++; await blocked; return []; }), connectedTasks: () => [], send: unexpected, logger: noopLogger });
  const first = worker.runOnce(), second = worker.runOnce(); expect(first).toBe(second); await Promise.resolve(); expect(reads).toBe(1);
  let stopped = false; const stopping = worker.stop().then(() => { stopped = true; }); await Promise.resolve(); expect(stopped).toBe(false);
  release(); await stopping; expect(stopped).toBe(true); worker.start(); worker.start(); await worker.stop(); expect(reads).toBe(2);
});

test('one failing numeric execution cannot prevent the next source from being polled', async () => {
  const first = developmentRegistration(), second = developmentRegistration(), calls: string[] = [];
  const snapshot = (registration: typeof first) => ({ registration, receipt: null, persistedThrough: 0, runnerAcknowledgedThrough: 0, sourceAcknowledgedThrough: 0, offeredThrough: 0, complete: false, drainReason: null, loss: null, closure: null });
  const worker = developmentUsageWorker({ store: storeWith(async () => [snapshot(first), snapshot(second)]), connectedTasks: () => [first.runtimeTaskId, second.runtimeTaskId], logger: noopLogger, send: async (taskId) => {
    calls.push(taskId); if (taskId === first.runtimeTaskId) throw new Error('temporary network failure');
    return { version: 1, runtimeTaskId: second.runtimeTaskId, journalId: second.key.journalId, incarnation: second.key.incarnation, podUid: second.podUid, receipt: null };
  } });
  await worker.runOnce(); expect(calls).toEqual([first.runtimeTaskId, second.runtimeTaskId]); await worker.stop();
});

test('temporary PG polling failure is logged and retried without creating a loss proof', async () => {
  const warnings: string[] = [];
  const worker = developmentUsageWorker({ store: storeWith(async () => { throw new Error('PG unavailable'); }), connectedTasks: () => [], send: unexpected, logger: { ...noopLogger, warn: (message) => { warnings.push(message); } } });
  await worker.runOnce(); await worker.runOnce(); expect(warnings).toEqual(['development usage ingestion unavailable', 'development usage ingestion unavailable']); await worker.stop();
});
