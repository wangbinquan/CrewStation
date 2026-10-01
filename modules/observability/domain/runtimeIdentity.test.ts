import { expect, test } from 'bun:test';
import { RuntimeTaskFactSchema, UsageExecutionIdentitySchema, ExecutionObservationIdentitySchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { runtimeMatchesAttempt, runtimeOwnsIdentity, runtimeLedgerScope, validateRuntimeFacts } from './runtimeIdentity';
function fact() {
  const i = { sourceKind: 'development-agent', projectId: newResourceId(), taskId: newResourceId(), agentId: newResourceId(), executionId: newResourceId(), executionGeneration: 1 };
  return RuntimeTaskFactSchema.parse({ id: i.executionId, projectId: i.projectId, serviceId: newResourceId(), name: i.agentId, source: { kind: 'development-agent', identity: i, workspaceName: null }, protocol: 'development', state: 'running', createdAt: '2026-09-30T00:00:00.000Z', closedAt: null, traceId: null, attemptsPartial: false,
    attempts: [{ id: i.agentId, taskId: i.taskId, name: i.agentId, kind: 'agent', state: 'running', attempt: 1, executionId: i.executionId, agentId: i.agentId, profileId: newResourceId(), profileRevision: 7, createdAt: '2026-09-30T00:00:00.000Z', startedAt: null, endedAt: null }] });
}
test('development uses parent workspace only as ledger scope and full Agent identity for contribution', () => {
  const f = fact(), i = f.source!.kind === 'development-agent' ? f.source!.identity : undefined; if (!i) throw new Error('fixture');
  validateRuntimeFacts([f]); expect(runtimeLedgerScope(f)).toEqual({ projectId: i.projectId, taskId: i.taskId }); expect(runtimeMatchesAttempt(f, f.attempts[0]!, i)).toBe(true);
  for (const patch of [{ projectId: newResourceId() }, { taskId: newResourceId() }, { executionId: newResourceId() }, { executionGeneration: 2 }, { sourceKind: 'development-cli' as const }]) expect(runtimeOwnsIdentity(f, UsageExecutionIdentitySchema.parse({ ...i, ...patch }))).toBe(false);
  const wrongAgent = { ...i, agentId: newResourceId() }; expect(runtimeOwnsIdentity(f, wrongAgent)).toBe(true); expect(runtimeMatchesAttempt(f, f.attempts[0]!, wrongAgent)).toBe(false);
  const business = ExecutionObservationIdentitySchema.parse({ projectId: i.projectId, taskId: i.taskId, subtaskId: i.agentId, executionId: i.executionId, executionGeneration: 1 }); expect(runtimeOwnsIdentity(f, business)).toBe(false);
});
test('duplicate and corrupt owner facts are rejected before any monetary aggregation', () => {
  const f = fact(); expect(() => validateRuntimeFacts([f, structuredClone(f)])).toThrow('重复');
  for (const patch of [{ id: newResourceId() }, { projectId: newResourceId() }, { closedAt: '2026-09-30T00:01:00.000Z' }, { attempts: [] }, { attempts: [{ ...f.attempts[0]!, profileId: null }] }]) expect(() => validateRuntimeFacts([RuntimeTaskFactSchema.parse({ ...f, ...patch })])).toThrow('原执行身份');
});
