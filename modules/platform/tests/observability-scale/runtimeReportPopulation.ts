// Explicit synthetic acceptance population in original physical relations, never source-owner arrays.
import {
  BusinessTaskV3DtoSchema, BusinessSubtaskV3DtoSchema, TasksSpecSchema,
  ExecutionObservationIdentitySchema, NativeUsageProofSchema, UsageRecordSchema, UsageValuationSchema,
  TokenPriceVersionSchema, ProjectIdSchema, ServiceIdSchema, UserIdSchema, type UsageRecord,
} from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import type { TestDatabase } from '@crewstation/testkit';
import { projects, services } from '../../../project/adapters/persistence/tables';
import { profiles } from '../../../agent-runtime/adapters/persistence/tables';
import { executionOperations } from '../../../business-task/adapters/persistence/executionTables';
import { executionSubtasks } from '../../../business-task/adapters/persistence/execution/subtaskTables';
import { executionLogs } from '../../../business-task/adapters/persistence/execution/projectionTables';
import { usageProjections, executionValuations, nativeCaptures, nativeSteps, usageHeads, costVisibility,
  tokenPrices, tokenPriceHeads, acceptedExecutionPrices } from '../../../observability/adapters/persistence/tables';
import { rebuildUsageProjection, nativeCaptureSummary, type NativeCaptureDocument } from '../../../observability/domain/usageProjection';
import { valueTokenUsage } from '../../../observability/domain/cnyPricing';

export const acceptanceNote = 'ACCEPTANCE-ONLY-CNY-NOT-SUPPLIER-BILL';
export const populationWindow = { from: '2026-10-03T00:00:00.000Z', to: '2026-10-04T00:00:00.000Z', timezone: 'Asia/Shanghai' };
const at = populationWindow.from, endedAt = '2026-10-03T00:00:10.000Z';
const rates = { input: '1', cacheRead: '2', cacheWrite: '3', output: '4' };
export const perRecordTokens = { input: '1', cacheRead: '3', cacheWrite: '5', output: '7' };
export const originalProjectName = acceptanceNote + ' Project';
export const originalProfileName = acceptanceNote + ' Compute';
export const sourceId = acceptanceNote + '/original-runner';
export const modelRef = acceptanceNote + '/model';
/** UUIDv7 namespaces are independent; an ordinal can be verified without retaining the full population. */
export function populationId(namespace: number, ordinal: number): string {
  if (!Number.isInteger(namespace) || namespace < 0 || namespace > 4095 || !Number.isSafeInteger(ordinal) || ordinal < 0) throw new RangeError('Invalid acceptance identity');
  const suffix = ordinal.toString(16); if (suffix.length > 12) throw new RangeError('Acceptance identity exhausted');
  return `019a0000-0000-7${namespace.toString(16).padStart(3, '0')}-8000-${suffix.padStart(12, '0')}`;
}
export const projectId = ProjectIdSchema.parse(populationId(1, 0));
export const serviceId = ServiceIdSchema.parse(populationId(2, 0));
export const actor = { userId: UserIdSchema.parse(populationId(3, 0)), isAdmin: true };
export const profileId = populationId(4, 0);
export function populationIdentity(n: number) {
  return ExecutionObservationIdentitySchema.parse({ projectId, taskId: populationId(10, n), subtaskId: populationId(11, n), executionId: populationId(12, n), executionGeneration: 1 });
}
export function populationDimensions(tasks: number, recordsPerTask: number) {
  if (!Number.isSafeInteger(tasks) || tasks <= 0 || !Number.isSafeInteger(recordsPerTask) || recordsPerTask <= 0 || !Number.isSafeInteger(tasks * recordsPerTask)) throw new RangeError('Acceptance population must be positive exact integers');
  return { tasks, recordsPerTask, records: tasks * recordsPerTask };
}
export async function seedPopulationDirectories(tdb: TestDatabase) {
  const now = new Date(at);
  await tdb.db.insert(projects).values({ id: projectId, slug: 'observability-scale-acceptance', name: originalProjectName, kind: 'digital-worker', namespace: 'acceptance-only', ownerUserId: actor.userId, state: 'active', template: 'acceptance-only', createdBy: actor.userId, createdAt: now, updatedAt: now });
  await tdb.db.insert(services).values({ id: serviceId, projectId, name: 'acceptance-only', kind: 'digital-worker', identity: acceptanceNote, createdAt: now });
  await tdb.db.insert(profiles).values({ id: profileId, name: originalProfileName, protocol: 'opencode', currentRevision: 7, createdBy: actor.userId, updatedBy: actor.userId, createdAt: now, updatedAt: now });
  await tdb.db.insert(costVisibility).values({ projectId, revision: 1, document: { projectId, visibility: 'project-members-and-services', revision: 1, updatedAt: at } });
  const price = TokenPriceVersionSchema.parse({ id: populationId(5, 0), profileId, revision: 1, profileRevision: 7, protocol: 'opencode', provider: acceptanceNote, model: modelRef, condition: null, currency: 'CNY', rates, effectiveFrom: at, sourceNote: acceptanceNote, createdAt: at, createdBy: actor.userId });
  await tdb.db.insert(tokenPriceHeads).values({ profileId, revision: 1 });
  await tdb.db.insert(tokenPrices).values({ profileId, revision: 1, id: price.id, requestKey: acceptanceNote, fingerprint: jsonHash(price), profileRevision: 7, protocol: price.protocol, provider: price.provider, model: price.model, condition: null, effectiveFrom: at, document: price });
}
function taskOperation(n: number) {
  const task = BusinessTaskV3DtoSchema.parse({ id: populationId(10, n), serviceId, state: 'closed', releaseId: populationId(6, 0), taskContractVersion: 'acceptance-v1', contractDigest: 'a'.repeat(64), generation: 1, volumeMode: 'follow-container', volumeUid: null, taskProfileId: populationId(7, 0), traceId: n.toString(16).padStart(32, '0'), labels: { name: acceptanceNote + ' Task ' + n }, resourceState: 'released', quotaHeld: false, createdAt: at, closedAt: endedAt });
  return { id: populationId(13, n), serviceId, kind: 'create-task', parentId: task.id, requestKey: acceptanceNote + '/' + n, requestDigest: jsonHash(task), effectiveDigest: jsonHash(task), state: 'succeeded', createdAt: new Date(at), updatedAt: new Date(endedAt),
    intent: { kind: 'create-task' as const, projectId, callerIdentity: acceptanceNote, task, tasksSpec: TasksSpecSchema.parse({ taskProfileId: populationId(7, 0), executionControl: 'fenced', acceptedTaskContractVersions: ['acceptance-v1'] }), environmentLabels: {} } };
}
function taskAttempt(n: number) {
  const view = BusinessSubtaskV3DtoSchema.parse({ id: populationId(11, n), taskId: populationId(10, n), name: acceptanceNote + ' Agent ' + n, kind: 'agent', state: 'succeeded', process: 'exited', attempt: 1, executionId: populationId(12, n), agentProfileId: populationId(14, n), computeProfileId: profileId, profileRevision: 7, createdAt: at, startedAt: at, endedAt });
  return { id: view.id, serviceId, taskId: view.taskId, requestKey: acceptanceNote + '/' + n, requestDigest: jsonHash(view), sealedPayload: 'acceptance-only/no-command', payloadDigest: jsonHash(view), fenced: true, dispatch: 'accepted', view, updatedAt: new Date(endedAt) };
}
export async function seedPopulationParents(tdb: TestDatabase, tasks: number, progress: (phase: string, rows: number) => void) {
  for (let first = 0; first < tasks; first += 100) {
    const ordinals = Array.from({ length: Math.min(100, tasks - first) }, (_, i) => first + i);
    await tdb.db.insert(executionOperations).values(ordinals.map(taskOperation));
    await tdb.db.insert(executionSubtasks).values(ordinals.map(taskAttempt));
    await tdb.db.insert(executionLogs).values(ordinals.map(n => ({ taskId: populationId(10, n), serviceId, closedAt: new Date(endedAt), taskState: 'closed' })));
    await tdb.db.insert(acceptedExecutionPrices).values(ordinals.map(n => {
      const document = { identity: populationIdentity(n), profile: { id: profileId, revision: 7, protocol: 'opencode' as const }, acceptedAt: at, priceBookRevision: 1 };
      return { executionId: document.identity.executionId, generation: 1, fingerprint: jsonHash(document), document };
    }));
    if ((first + ordinals.length) % 1000 === 0 || first + ordinals.length === tasks) progress('physical-parents', first + ordinals.length);
  }
}
function originalRecord(task: number, local: number, recordsPerTask: number): UsageRecord {
  return UsageRecordSchema.parse(rebuildUsageProjection([{ identity: populationIdentity(task), kind: 'usage', sourceId, recordId: 'record-' + (task * recordsPerTask + local), revision: 1, occurredAt: at, observedAt: at, adapterVersion: acceptanceNote, modelRef, reporting: 'delta', inclusion: 'self', coverage: 'complete', validity: 'valid', scope: { root: 'root-' + task, session: 'root-' + task, parentSession: null, ancestors: [], turn: 'turn-' + task, turnIndex: 0, level: 'request' }, coveredThroughTurn: null, basis: { kind: 'invocation' }, usage: perRecordTokens }]));
}
function originalCapture(task: number, records: number): NativeCaptureDocument {
  return { id: 'capture-' + task, identity: populationIdentity(task), sourceId, began: true, baselineRoot: 'root-' + task, historicalRevisionGap: false,
    proof: NativeUsageProofSchema.parse({ contract: 'opencode-child-steps-v1', lineageKey: acceptanceNote + '/lineage-' + task, turn: 'turn-' + task, turnIndex: 0, state: 'complete', root: 'root-' + task, observedAt: at, baseline: { kind: 'fresh', fingerprint: null }, fingerprint: jsonHash([acceptanceNote, task, records]), sessions: 1, steps: records, emitted: records, baselineSteps: 0, priorRevisionGap: false, issues: [] }) };
}
async function seedTaskUsage(tdb: TestDatabase, task: number, recordsPerTask: number) {
  const taskKey = jsonHash({ projectId, taskId: populationId(10, task) }), capture = originalCapture(task, recordsPerTask);
  // Original ownership constraints require the physical capture before its step membership.
  await tdb.db.insert(nativeCaptures).values({ id: capture.id, taskKey, sourceId, turn: capture.proof.turn, lineageKey: capture.proof.lineageKey, root: capture.proof.root, finalized: true, document: capture, summary: nativeCaptureSummary(capture, { steps: recordsPerTask, baselines: 0, unresolved: 0, revised: 0 }) });
  for (let first = 0; first < recordsPerTask; first += 100) {
    const records = Array.from({ length: Math.min(100, recordsPerTask - first) }, (_, i) => originalRecord(task, first + i, recordsPerTask));
    const key = (record: UsageRecord) => jsonHash({ identity: record.identity, sourceId, recordId: record.recordId });
    await tdb.db.insert(usageProjections).values(records.map(document => ({ meterKey: key(document), taskKey, document })));
    await tdb.db.insert(executionValuations).values(records.map(record => ({ meterKey: key(record), taskKey, basisFingerprint: jsonHash(record), document: UsageValuationSchema.parse({ kind: 'valuation', identity: record.identity, sourceId, recordId: record.recordId, revision: 1, occurredAt: at, observedAt: at, valuationId: 'value-' + record.recordId, valuationRevision: 1, usageRevision: record.projection.projectionRevision, currency: 'CNY', completeness: 'complete', availability: 'priced', priceVersionRef: populationId(5, 0), amountDecimal: valueTokenUsage(record.projection.contribution, rates).knownAmount }) })));
    await tdb.db.insert(nativeSteps).values(records.map(record => ({ captureId: capture.id, recordId: record.recordId, taskKey, nativeKey: jsonHash([record.identity, record.recordId]), root: capture.proof.root!, revision: 1, fingerprint: jsonHash(record) })));
  }
  await tdb.db.insert(usageHeads).values({ taskKey, projectId, taskId: populationId(10, task), sequence: recordsPerTask });
}
export async function seedRuntimePopulation(tdb: TestDatabase, tasks: number, recordsPerTask: number, progress: (phase: string, rows: number) => void = () => {}) {
  const size = populationDimensions(tasks, recordsPerTask);
  await seedPopulationDirectories(tdb);
  await seedPopulationParents(tdb, tasks, progress);
  for (let task = 0; task < tasks; task++) {
    await seedTaskUsage(tdb, task, recordsPerTask);
    if ((task + 1) % 1000 === 0 || task + 1 === tasks) progress('physical-usage', (task + 1) * recordsPerTask);
  }
  return size;
}
