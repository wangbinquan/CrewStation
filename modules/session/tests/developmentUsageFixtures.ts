import type { DevelopmentUsageEvent, DevelopmentUsageReceipt, DevelopmentUsageRegistration, RunnerUsageCapture } from '@crewstation/contracts';
import { ProjectIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';

export const developmentAt = '2026-09-30T06:00:00.000Z';
export function developmentRegistration(): DevelopmentUsageRegistration {
  const runtimeTaskId = TaskIdSchema.parse(newResourceId());
  return { runtimeTaskId, key: { executionId: runtimeTaskId, journalId: crypto.randomUUID(), incarnation: crypto.randomUUID(), payloadDigest: 'a'.repeat(64) }, podUid: 'pod-' + runtimeTaskId,
    identity: { sourceKind: 'development-agent', projectId: ProjectIdSchema.parse(newResourceId()), taskId: TaskIdSchema.parse(newResourceId()), executionId: runtimeTaskId, executionGeneration: 1, agentId: newResourceId() }, profileId: newResourceId(), profileRevision: 3 };
}
export function developmentReceipt(registration: DevelopmentUsageRegistration, through = 0, patch: Partial<DevelopmentUsageReceipt> = {}): DevelopmentUsageReceipt {
  const { runtimeTaskId: _id, ...header } = registration;
  return { ...header, phase: 'running', lastSequence: through, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null, ...patch };
}
export const developmentCapture = (revision: number): RunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [{
  recordId: 'step-' + revision, revision, occurredAt: null, observedAt: developmentAt, adapterVersion: 'fixture@1', actualModel: null,
  reporting: 'delta', inclusion: 'self', coverage: 'partial', validity: 'valid', basis: { kind: 'invocation' }, coveredThroughTurn: null,
  scope: { root: 'native', session: 'native', parentSession: null, ancestors: [], turn: 'turn', turnIndex: 0, level: 'request' },
  usage: { input: '9007199254740993', cacheRead: null, cacheWrite: '0', output: '11' },
}] });
export const developmentEvents = (after: number, count: number): DevelopmentUsageEvent[] => Array.from({ length: count }, (_, i) => ({ sequence: after + i + 1, occurredAt: developmentAt, capture: developmentCapture(after + i + 1) }));
export const developmentPage = (registration: DevelopmentUsageRegistration, after: number, count: number) => ({ key: registration.key, after, through: after + count, events: developmentEvents(after, count) });
