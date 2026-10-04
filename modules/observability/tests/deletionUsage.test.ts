import { describe, expect, test } from 'bun:test';
import { TaskIdSchema, ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import type { ProjectDeletionContext, RunnerBusinessReceipt, RunnerUsageSourcePage, TaskId } from '@crewstation/contracts';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { drainOriginalObservationUsage } from '../application/deletion/usage';
import type { ObservationOriginalUsage } from '../ports/deletionUsage';
import { target } from './projectDeletionFixture';

const context: ProjectDeletionContext = { operationId: newResourceId(), target, phase: 'stop', generation: 1,
  confirmed: { participant: 'observability', complete: true, resources: [], references: [], blockers: [], revision: jsonHash('controlled directory') } };
function sourceFixture() {
  const ids = Array.from({ length: 403 }, () => TaskIdSchema.parse(newResourceId())).sort(), selected = ids[0]!;
  const receipts: RunnerBusinessReceipt[] = Array.from({ length: 101 }, (_, index) => ({ executionId: newResourceId(),
    attempt: 1, incarnation: 'original-incarnation', payloadDigest: jsonHash('original payload'), phase: 'running', lastSequence: index ? 1 : 26, acknowledgedSequence: 0, outputBytes: 0, result: null }));
  const firstExecution = receipts[0]!.executionId; receipts.sort((a, b) => a.executionId.localeCompare(b.executionId));
  const acknowledged = new Map<string, number>(); let taskPages = 0, originals = 0, written = 0, copied = 0;
  const page = (executionId: string): RunnerUsageSourcePage | null => {
    const receipt = receipts.find((row) => row.executionId === executionId)!, after = acknowledged.get(executionId) ?? 0;
    if (after === receipt.lastSequence) return null;
    return { runtimeTaskId: selected, executionId, attempt: 1, incarnation: receipt.incarnation, payloadDigest: receipt.payloadDigest, after, through: after + 1,
      events: [{ sequence: after + 1, agentId: 'original-agent', occurredAt: '2026-10-04T00:00:00Z', capture: { version: 1, diagnostics: [], measurements: [] } }] };
  };
  const source: ObservationOriginalUsage = {
    tasks: async (_context, after) => { taskPages++; return ids.filter((id) => after === null || id > after).slice(0, 200); },
    task: async (_context, id: TaskId) => ({
      originalBusiness: async (after) => { originals++; return id === selected ? receipts.filter((receipt) => after === null || receipt.executionId > after).slice(0, 100) : []; },
      offerBusiness: async (executionId) => page(executionId),
      acknowledgeBusiness: async (executionId, through) => { copied++; acknowledged.set(executionId, through); },
      businessMeasurement: async () => undefined, lookupDevelopmentUsage: async () => ({ version: 1, runtimeTaskId: id, kind: 'absent' }),
      offerDevelopment: async () => null, acknowledgeDevelopment: async () => { throw new Error('No development source'); },
    }),
    business: async (page) => ExecutionObservationIdentitySchema.parse({ projectId: target.id, taskId: selected, executionId: page.executionId, executionGeneration: 1, subtaskId: selected }),
    development: async () => undefined,
  };
  const writer = { business: async () => { written++; }, development: async () => { throw new Error('No development source'); } };
  return { source, writer, acknowledged, ids, firstExecution, stats: () => ({ taskPages, originals, written, copied }) };
}
describe('original observation EOF and failure propagation', () => {
  test('reads every task and original execution page, including more than twenty source pages, until actual EOF', async () => {
    const f = sourceFixture(); await drainOriginalObservationUsage(f.source, f.writer)(context);
    expect(f.stats()).toEqual({ taskPages: 4, originals: 405, written: 126, copied: 126 });
    expect(f.acknowledged.size).toBe(101); expect(f.acknowledged.get(f.firstExecution)).toBe(26);
  });
  test('failed attribution or commit never acknowledges the source or swallows the failure', async () => {
    const f = sourceFixture();
    await expect(drainOriginalObservationUsage({ ...f.source, business: async () => undefined }, f.writer)(context)).rejects.toThrow('独立项目归属');
    expect(f.stats().copied).toBe(0);
    await expect(drainOriginalObservationUsage(f.source, { ...f.writer, business: async () => { throw new Error('original ledger failed'); } })(context)).rejects.toThrow('original ledger failed');
    expect(f.stats().copied).toBe(0); expect(f.acknowledged.size).toBe(0);
    await expect(drainOriginalObservationUsage({ ...f.source, tasks: async () => [f.ids[1]!, f.ids[0]!] }, f.writer)(context)).rejects.toThrow('不连续或重复');
  });
});
