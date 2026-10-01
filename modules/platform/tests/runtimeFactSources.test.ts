// Full contract facts keep bounded owner composition meaningful without dispatching models.
import { expect, test } from 'bun:test';
import { RuntimeTaskFactSchema, type RuntimeTaskFact } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { runtimeFactSources } from '../application/runtimeFactSources';
const query = { from: '2026-09-30T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', timezone: 'Asia/Shanghai' };
const executor = { snapshot: 'one-read-snapshot' };
const projectId = newResourceId(), serviceId = newResourceId(), workspaceId = newResourceId();
const ids = new Map<string, string>();
function identity(label: string) { const id = ids.get(label) ?? newResourceId(); ids.set(label, id); return id; }
function row(name: string, createdAt = query.from): RuntimeTaskFact {
  return RuntimeTaskFactSchema.parse({ id: identity(name), projectId, serviceId, name, createdAt,
    protocol: 'v3', state: 'closed', closedAt: null, traceId: null, attemptsPartial: false, attempts: [] });
}
function developmentRow(name: string, createdAt = query.from): RuntimeTaskFact {
  const base = row(name, createdAt), agentId = identity(name + '-agent');
  return RuntimeTaskFactSchema.parse({ ...base, protocol: 'development',
    source: { kind: 'development-agent', workspaceName: null,
      identity: { sourceKind: 'development-agent', projectId, taskId: workspaceId, agentId, executionId: base.id, executionGeneration: 1 } },
    attempts: [{ id: agentId, taskId: workspaceId, name: agentId, kind: 'agent', state: 'closed', attempt: 1, executionId: base.id,
      agentId, profileId: identity(name + '-profile'), profileName: 'Accepted development compute', profileRevision: 7, createdAt, startedAt: null, endedAt: null }] });
}
test('each owner receives the same snapshot and source filter happens before bounded owner reads', async () => {
  const seen: string[] = [];
  const source = runtimeFactSources({ business: async (tx, q) => { expect(tx).toBe(executor); expect(q).toBe(query); seen.push('b'); return { items: [row('b')], partial: false }; },
    development: async (tx) => { expect(tx).toBe(executor); seen.push('d'); return { items: [developmentRow('d')], partial: false }; } });
  expect((await source(executor, query)).items.map((r) => r.name)).toEqual(['b', 'd']); expect(seen).toEqual(['b', 'd']);
  const selected = runtimeFactSources({ business: async () => { throw new Error('unselected source'); }, development: async () => ({ items: [developmentRow('d')], partial: false }) });
  expect(await selected(executor, { ...query, sourceKind: 'development-agent' })).toMatchObject({ items: [developmentRow('d')], partial: false, sourceScope: 'project-executions' });
});
test('combined bound, owner truncation and independent detail are explicit', async () => {
  const outside = developmentRow('outside-overview', '2026-09-30T01:00:00.000Z');
  const source = runtimeFactSources({ business: async (_tx, q) => ({ items: q.taskId ? [] : Array.from({ length: 200 }, (_, n) => row('b' + n)), partial: false }),
    development: async (_tx, q) => ({ items: [q.taskId ? outside : developmentRow('d', '2026-09-30T01:00:00.000Z')], partial: false }) });
  const combined = await source(executor, query); expect(combined.items).toHaveLength(200); expect(combined.items[0]?.name).toBe('d'); expect(combined.partial).toBe(true);
  expect(await source(executor, { ...query, taskId: outside.id })).toMatchObject({ items: [outside], partial: false });
  const partial = runtimeFactSources({ business: async () => ({ items: [], partial: true }), development: async () => ({ items: [], partial: false }) });
  expect((await partial(executor, query)).partial).toBe(true);
});
test('cross-source object collisions fail rather than merge unrelated money', async () => {
  const owner = async () => ({ items: [row('same')], partial: false });
  await expect(runtimeFactSources({ business: owner, development: owner })(executor, query)).rejects.toMatchObject({ kind: 'conflict' });
});
test('combined attempts remain at 2000 without stripping the unique development attempt', async () => {
  const base = row('business-many'), prototype = developmentRow('prototype').attempts[0]!;
  const business = RuntimeTaskFactSchema.parse({ ...base, attempts: Array.from({ length: 2000 }, (_, n) => ({ ...prototype,
    id: identity('business-subtask-' + n), taskId: base.id, executionId: identity('business-execution-' + n) })) });
  const development = developmentRow('development-one');
  const source = runtimeFactSources({ business: async () => ({ items: [business], partial: false }), development: async () => ({ items: [development], partial: false }) });
  const result = await source(executor, query); expect(result.items.reduce((n, r) => n + r.attempts.length, 0)).toBe(2000); expect(result.partial).toBe(true);
  expect(result.items.find(r => r.id === development.id)?.attempts).toHaveLength(1);
  expect(result.items.find(r => r.id === business.id)?.attemptsPartial).toBe(true);
});
