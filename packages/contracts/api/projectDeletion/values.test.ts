import { expect, test } from 'bun:test';
import { AcceptProjectDeletionSchema, ProjectDeletionInventorySchema } from './values';
import { ProjectDeletionOperationSchema, ProjectDeletionPlanSchema } from './responses';

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
test('重新确认材料必须绑定原操作和前一摘要，最小历史拒绝原文、重复键和偏离当前摘要', () => {
  const id = () => Bun.randomUUIDv7(), projectId = id(), digest = 'a'.repeat(64), date = '2026-10-01T00:00:00.000Z';
  const plan = { id: id(), target: { id: projectId, slug: 'confirmed', name: '确认测试', kind: 'DigitalWorker', namespace: 'cs-confirmed', state: 'deleting', revision: '1', prodHost: 'confirmed.test', previewHost: 'preview.confirmed.test', serviceHost: 'confirmed.svc.test' },
    digest, expiresAt: date, complete: true, participants: [], blockers: [] };
  const operationId = id(); expect(ProjectDeletionPlanSchema.safeParse({ ...plan, operationId, supersedes: digest }).success).toBe(true);
  for (const patch of [{ operationId }, { supersedes: digest }, { operationId, supersedes: 'other' }]) expect(ProjectDeletionPlanSchema.safeParse({ ...plan, ...patch }).success).toBe(false);
  const operation = { id: operationId, project: { id: projectId, slug: 'confirmed', name: '确认测试' }, state: 'accepted', phase: 'seal', confirmationDigest: digest, receipts: [], blockers: [], canRetry: true, createdAt: date, updatedAt: date };
  const confirmation = { planId: plan.id, requestKey: id(), digest, confirmedBy: id(), confirmedAt: date };
  expect(ProjectDeletionOperationSchema.safeParse({ ...operation, confirmations: [confirmation] }).success).toBe(true);
  for (const confirmations of [[], [confirmation, confirmation], [{ ...confirmation, digest: 'b'.repeat(64) }], [{ ...confirmation, resources: ['private-content'] }]]) {
    expect(ProjectDeletionOperationSchema.safeParse({ ...operation, confirmations }).success).toBe(false);
  }
});
