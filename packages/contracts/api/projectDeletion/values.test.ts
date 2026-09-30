import { expect, test } from 'bun:test';
import { AcceptProjectDeletionSchema, ProjectDeletionInventorySchema } from './values';

test('删除确认严格绑定完整 UUIDv7 和 delete，不接受名单、未知字段或模糊确认', () => {
  const input = { planId: Bun.randomUUIDv7(), requestKey: Bun.randomUUIDv7(), confirm: 'delete' as const };
  expect(AcceptProjectDeletionSchema.parse(input)).toEqual(input);
  for (const patch of [{ confirm: 'DELETE' }, { confirm: true }, { planId: 'slug' }, { requestKey: 'short' }, { resources: [] }]) expect(AcceptProjectDeletionSchema.safeParse({ ...input, ...patch }).success).toBe(false);
});
test('盘点必需完整性与来源摘要，拒绝未知 owner、负数量和无原身份的对象', () => {
  const report = { participant: 'scm' as const, revision: 'a'.repeat(64), complete: true, resources: [{ kind: 'repository', id: '8', identity: 'remote-id=8,path=group/slug', count: 1 }], references: [], blockers: [] };
  expect(ProjectDeletionInventorySchema.parse(report)).toEqual(report);
  for (const patch of [{ participant: 'unknown' }, { complete: undefined }, { revision: 'unknown' }, { resources: [{ ...report.resources[0], count: -1 }] }, { resources: [{ ...report.resources[0], identity: '' }] }]) expect(ProjectDeletionInventorySchema.safeParse({ ...report, ...patch }).success).toBe(false);
});
