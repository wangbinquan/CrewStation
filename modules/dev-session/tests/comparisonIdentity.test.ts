import { expect, test } from 'bun:test';
import type { TaskId } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';
import { createTestDatabase, testDatabaseAvailable } from '@crewstation/testkit';
import { drizzleComparisonReferences } from '../adapters/persistence/drizzleComparisonReferences';
import { legacyComparisonReference } from '../adapters/persistence/legacyComparisonReference';
import { drizzleAgentStarts } from '../adapters/persistence/drizzleAgentStarts';
import { devSessionMigrations } from '../wiring';

const available = await testDatabaseAvailable();
test.skipIf(!available)('比较索引使用持久 UUID，同一比较跨副本复用，过期引用失效', async () => {
  const tdb = await createTestDatabase([devSessionMigrations]);
  try {
    let now = Date.now(); const clock = { now: () => new Date(now) };
    const a = drizzleComparisonReferences(tdb.db, clock), b = drizzleComparisonReferences(tdb.db, clock);
    const input = { taskId: newResourceId() as TaskId, runnerComparisonId: newResourceId(), target: 'prod' as const, deployment: 'undeployed' };
    const ids = await Promise.all([a.create(input), b.create(input)]);
    expect(ResourceIdSchema.safeParse(ids[0]).success).toBe(true);
    expect(ids[0]).toBe(ids[1]);
    expect(await b.get(ids[0]!)).toEqual({ ...input, id: ids[0] });
    expect(await b.get('display-name')).toBeUndefined();
    expect(await a.create({ ...input, target: 'preview' })).not.toBe(ids[0]);
    now += 25 * 60 * 60 * 1000;
    expect(await b.get(ids[0]!)).toBeUndefined();
  } finally { await tdb.drop(); }
});

test('旧比较引用只在显式适配器中读取，不能当名称查询当前目录', async () => {
  const taskId = newResourceId() as TaskId, releaseId = newResourceId(), runnerComparisonId = newResourceId();
  const raw = Buffer.from(JSON.stringify({ taskId: 'tsk_old', runnerId: '00000000-0000-4000-8000-000000000001', target: 'prod', deployment: 'rel_old:abc' })).toString('base64url');
  const directory = { resolve: async (kind: string, keys: readonly string[]) => kind === 'task' && keys[0] === 'tsk_old' ? taskId : kind === 'release' && keys[0] === 'rel_old' ? releaseId : undefined,
    aliases: async () => [], bind: async () => runnerComparisonId };
  expect(await legacyComparisonReference(raw, directory)).toEqual({ taskId, runnerComparisonId, target: 'prod', deployment: `${releaseId}:abc` });
  expect(await legacyComparisonReference(raw)).toBeUndefined();
  expect(await legacyComparisonReference('invalid', directory)).toBeUndefined();
});

test.skipIf(!available)('集群重开独立分配 Agent 与任务 UUID，多副本和并发重试复用持久受理结果', async () => {
  const tdb = await createTestDatabase([devSessionMigrations]);
  try {
    const a = drizzleAgentStarts(tdb.db), b = drizzleAgentStarts(tdb.db), operationId = newResourceId();
    const pairs = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).reserveRestart(operationId)));
    expect(pairs.every((pair) => pair.agentId === pairs[0]!.agentId && pair.taskId === pairs[0]!.taskId)).toBe(true);
    for (const id of [pairs[0]!.agentId, pairs[0]!.taskId]) expect(ResourceIdSchema.safeParse(id).success).toBe(true);
    expect(new Set([operationId, pairs[0]!.agentId, pairs[0]!.taskId]).size).toBe(3);
    expect(await a.reserveRestart(newResourceId())).not.toEqual(pairs[0]!);
  } finally { await tdb.drop(); }
});
