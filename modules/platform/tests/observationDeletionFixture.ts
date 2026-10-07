import { ProjectIdSchema, ProjectDeletionTargetSchema, TaskIdSchema, ExecutionObservationIdentitySchema, DevelopmentUsageRegistrationSchema } from '@crewstation/contracts';
import type { DevelopmentUsageResolved } from '../../observability/ports/developmentUsage';
import type { TestDatabase } from '@crewstation/testkit';
import type { ProjectDeletionContext, RunnerUsageCapture } from '@crewstation/contracts';
import { request as httpRequest } from 'node:http';
import { createApp } from '@crewstation/http';
import { createFakeK8sClient } from '@crewstation/k8s';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import { createSessionModule, sessionMigrations } from '@crewstation/module-session';
import { createObservabilityModule, observabilityMigrations } from '@crewstation/module-observability';
import { resourceIdentityDirectory, runMigrations } from '@crewstation/persistence';
import { createProjectDeletionSessionClient } from '@crewstation/session-client';
import { createTestDatabase } from '@crewstation/testkit';
import { sql } from 'drizzle-orm';
import { originalObservationUsage } from '../application/deletion/observationUsage';

const at = '2026-10-04T00:00:00.000Z';
export const originalCapture = (sequence: number): RunnerUsageCapture => ({ version: 1, diagnostics: [], measurements: [{
  recordId: 'original-' + sequence, revision: 1, occurredAt: null, observedAt: at, adapterVersion: 'controlled-original@1', actualModel: null,
  reporting: 'delta', inclusion: 'self', coverage: 'partial', validity: 'valid', basis: { kind: 'invocation' }, coveredThroughTurn: null, scope: null,
  usage: { input: '9007199254740993', cacheRead: null, cacheWrite: '0', output: '11' },
}] });
const loopback = (input: string | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
  const url = new URL(String(input));
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') { reject(new Error('Fixture HTTP requires its actual loopback server')); return; }
  const req = httpRequest(url, { method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)) }, (response) => {
    const chunks: Buffer[] = []; response.on('data', (chunk) => chunks.push(Buffer.from(chunk))); response.on('error', reject);
    response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
  });
  const abort = () => req.destroy(new Error('Fixture HTTP request aborted'));
  if (init?.signal?.aborted) { abort(); return; }
  init?.signal?.addEventListener('abort', abort, { once: true }); req.once('close', () => init?.signal?.removeEventListener('abort', abort));
  req.once('error', reject); req.end(init?.body ? String(init.body) : undefined);
});
/** Actual factories, legacy PostgreSQL copies and Session HTTP; upstream stop/identity grants are controlled. No real workload is created. */
export async function observationDeletionFixture(options: { native?: (database: TestDatabase, projectId: typeof ProjectIdSchema._output) => Promise<DevelopmentUsageResolved> } = {}) {
  const beforeFence = { ...sessionMigrations, files: sessionMigrations.files.filter((file) => file.name.localeCompare('0011_') < 0) };
  const database = await createTestDatabase([beforeFence, observabilityMigrations]);
  const projectId = ProjectIdSchema.parse(newResourceId()), otherId = ProjectIdSchema.parse(newResourceId()), operationId = newResourceId();
  const task = () => TaskIdSchema.parse(newResourceId());
  const ids = [task(), task(), task(), task()] as const, [businessRuntime, businessTask, developmentRuntime, developmentTask] = ids;
  const target = ProjectDeletionTargetSchema.parse({ id: projectId, slug: 'original-observation', name: 'Original observation', namespace: 'cs-original-observation',
    kind: 'DigitalWorker', state: 'active', revision: '1', prodHost: 'original.invalid', previewHost: 'preview.original.invalid', serviceHost: 'original.service.invalid' });
  const receipt = { executionId: newResourceId(), attempt: 1, incarnation: crypto.randomUUID(), payloadDigest: jsonHash('original business'),
    phase: 'running', lastSequence: 106, acknowledgedSequence: 0, outputBytes: 0, result: null };
  const businessIdentity = ExecutionObservationIdentitySchema.parse({ projectId, taskId: businessTask, executionId: receipt.executionId, executionGeneration: 1, subtaskId: newResourceId() });
  const registration = DevelopmentUsageRegistrationSchema.parse({ runtimeTaskId: developmentRuntime, key: { executionId: developmentRuntime, journalId: crypto.randomUUID(),
    incarnation: crypto.randomUUID(), payloadDigest: jsonHash('original development') }, podUid: 'controlled-original-pod', profileId: newResourceId(), profileRevision: 3,
    identity: { sourceKind: 'development-agent', projectId, taskId: developmentTask, executionId: developmentRuntime, executionGeneration: 1, agentId: newResourceId() } });
  await database.db.execute(sql`INSERT INTO session.business_executions(task_id,execution_id,receipt,persisted_through) VALUES(${businessRuntime},${receipt.executionId},${JSON.stringify(receipt)}::jsonb,106)`);
  await database.db.execute(sql`INSERT INTO session.business_usage_sources(task_id,execution_id,attempt,incarnation,payload_digest) VALUES(${businessRuntime},${receipt.executionId},1,${receipt.incarnation},${receipt.payloadDigest})`);
  for (let sequence = 1; sequence <= 106; sequence++) await database.db.execute(sql`INSERT INTO session.business_usage_events(task_id,execution_id,sequence,agent_id,occurred_at,capture)
    VALUES(${businessRuntime},${receipt.executionId},${sequence},'controlled-original-agent',${at},${JSON.stringify(originalCapture(sequence))}::jsonb)`);
  const developmentReceipt = { ...registration, phase: 'running', lastSequence: 8, acknowledgedSequence: 0, finalThrough: null, result: null, interruption: null };
  const { runtimeTaskId: _id, ...header } = developmentReceipt;
  await database.db.execute(sql`INSERT INTO session.development_usage_streams(task_id,registration,receipt,persisted_through) VALUES(${developmentRuntime},${JSON.stringify(registration)}::jsonb,${JSON.stringify(header)}::jsonb,8)`);
  for (let sequence = 1; sequence <= 8; sequence++) {
    const event = { sequence, occurredAt: at, capture: originalCapture(sequence) };
    await database.db.execute(sql`INSERT INTO session.development_usage_events(task_id,sequence,digest,event) VALUES(${developmentRuntime},${sequence},${jsonHash(event)},${JSON.stringify(event)}::jsonb)`);
  }
  await runMigrations(database.db, [sessionMigrations]);
  const native = await options.native?.(database, projectId), allIds = native ? [...ids, native.registration.runtimeTaskId, native.registration.identity.taskId] : ids;
  let valid = true, closing = false, ackFault: 'before' | 'after' | undefined, requests = 0;
  const grant = async (context: ProjectDeletionContext) => { if (!valid || context.operationId !== operationId || context.target.id !== projectId) throw precondition('controlled original Root expired'); };
  const server = Bun.serve({ port: 0, fetch: () => new Response('initializing', { status: 503 }) }), address = `http://127.0.0.1:${server.port}`;
  const processIdentity = { podUid: crypto.randomUUID(), containerId: 'containerd://' + 'a'.repeat(64), nodeUid: crypto.randomUUID(), nodeName: 'controlled-original-node',
    pid: process.pid, pidNamespace: '731', bootId: crypto.randomUUID(), startTicks: '91' };
  const session = createSessionModule({ db: database.db, isAdmin: async () => true, runnerAuth: { verifyRunnerToken: async () => ({ ok: true, projectId }) },
    taskAccess: { canOpenStream: async () => true, onRunnerConnected: async () => true, onRunnerDisconnected: async () => {} },
    deletionSources: { processes: { protectCurrent: async () => processIdentity, sweep: async () => {} }, resolve: async (key) => allIds.includes(key as typeof businessRuntime) ? { id: TaskIdSchema.parse(key), complete: true, scope: 'project', projectIds: [projectId], revision: jsonHash({ key, projectId }) } : undefined,
      tasks: async (id, after) => id === projectId ? allIds.filter((key) => after === null || key > after).sort().slice(0, 200) : [],
      assertGrant: grant, assertAvailable: async () => { if (closing) throw precondition('controlled project sealed'); } },
    settings: { selfAddress: address, commandTimeoutMs: 1000, runnerStaleMs: 30_000, replayLimit: 100 } });
  const app = createApp({ name: 'original-observation-session' }); app.route('/', session.http.internal); server.reload({ fetch: app.fetch });
  const request = async (url: string | URL, init?: RequestInit) => {
    requests++; const input = typeof init?.body === 'string' ? JSON.parse(init.body) as { operation?: { type: string } } : undefined;
    const ack = input?.operation?.type === 'business-source-ack', fault = ack ? ackFault : undefined;
    if (fault) ackFault = undefined;
    if (fault === 'before') throw new Error('controlled ACK request lost');
    const response = await loopback(url, init);
    if (fault === 'after') throw new Error('controlled ACK response lost'); return response;
  };
  const contexts = { projectDeletionParticipantContext: async (context: ProjectDeletionContext) => {
    await grant(context); if (!sessionContext) throw precondition('Original Session confirmation absent'); return { ...sessionContext, phase: context.phase, generation: context.generation };
  } };
  const originalUsage = originalObservationUsage(contexts, createProjectDeletionSessionClient(address, request), {
    resolveUsageSource: async (source) => source.runtimeTaskId === businessRuntime && source.executionId === receipt.executionId && source.attempt === 1 && source.incarnation === receipt.incarnation && source.payloadDigest === receipt.payloadDigest ? businessIdentity : undefined,
  }, { resolve: async (key) => native && jsonHash(key) === jsonHash(native.registration.key) ? native : accepted && jsonHash(key) === jsonHash(registration.key) ? { registration, price: accepted } : undefined });
  const module = createObservabilityModule({ db: database.db, k8s: createFakeK8sClient(), isAdmin: async () => true, authorizer: { authorize: async () => {} },
    services: { resolveServiceOfProject: async () => undefined }, slots: { slotRoles: async () => undefined },
    traces: { environments: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] }, deliveries: { traceKeys: async () => [], activeTraceIds: async () => [], list: async () => [] },
      businessTasks: { list: async () => [] }, sessions: { summarize: async () => [], events: async () => [] } },
    deletion: { identities: resourceIdentityDirectory(database.db, () => [sessionMigrations, observabilityMigrations]), assertGrant: grant,
      tasks: { list: async () => ({ ids: allIds, complete: true }) }, originalUsage },
  });
  const accepted = await module.api.acceptExecutionPrice({ identity: registration.identity, profile: { id: registration.profileId, revision: 3, protocol: 'opencode' } });
  const owner = module.api.deletionOwner!, confirmed = await owner.inspect(target);
  const context = (phase: ProjectDeletionContext['phase']): ProjectDeletionContext => ({ operationId, target, confirmed, phase, generation: 1 });
  const sessionContext: ProjectDeletionContext = { ...context('seal'), confirmed: await session.api.deletionOwner!.inspect(target) };
  const seal = async () => { const result = await session.api.deletionOwner!.run(sessionContext!); if (result.kind !== 'done') throw new Error('Session seal failed'); closing = true; return owner.run(context('seal')); };
  const close = async () => { server.stop(true); await database.drop(); };
  return { database, projectId, otherId, ids, registration, businessIdentity, receipt, owner, module, context, seal, close,
    revoke: () => { valid = false; }, restore: () => { valid = true; }, fault: (value: 'before' | 'after') => { ackFault = value; }, requests: () => requests };
}
