import { expect, test } from 'bun:test';
import { SetQuotaRequestSchema } from '../project';
import { ProjectServicePolicySchema, SaveProjectServicePolicySchema } from './projectResources';

test('服务范围支持继承与显式空清单，拒绝重复、未知字段、非 UUID 与超过 200 项', () => {
  const id = Bun.randomUUIDv7();
  for (const mode of ['inherit', 'restricted']) expect(ProjectServicePolicySchema.safeParse({ mode, allowedPlanIds: [] }).success).toBe(true);
  expect(ProjectServicePolicySchema.parse({ mode: 'restricted', allowedPlanIds: [id] }).allowedPlanIds).toEqual([id]);
  for (const value of [{ mode: 'inherit', allowedPlanIds: [id] }, { mode: 'restricted', allowedPlanIds: [id, id] },
    { mode: 'restricted', allowedPlanIds: ['small'] }, { mode: 'restricted', allowedPlanIds: [], anything: true },
    { mode: 'restricted', allowedPlanIds: Array.from({ length: 201 }, () => Bun.randomUUIDv7()) }]) expect(ProjectServicePolicySchema.safeParse(value).success).toBe(false);
  expect(SaveProjectServicePolicySchema.safeParse({ expectedRevision: -1, policy: { mode: 'inherit', allowedPlanIds: [] } }).success).toBe(false);
  expect(SaveProjectServicePolicySchema.safeParse({ expectedRevision: 0, policy: { mode: 'inherit', allowedPlanIds: [] }, ignored: 1 }).success).toBe(false);
});

test('配额旧客户端兼容，比较值可选且必须为正整数，目标额度保持 1–100', () => {
  expect(SetQuotaRequestSchema.parse({ maxConcurrentTasks: 1 })).toEqual({ maxConcurrentTasks: 1 });
  expect(SetQuotaRequestSchema.parse({ maxConcurrentTasks: 100, expectedMaxConcurrentTasks: 200 }).expectedMaxConcurrentTasks).toBe(200);
  for (const maxConcurrentTasks of [0, 101, 1.5]) expect(SetQuotaRequestSchema.safeParse({ maxConcurrentTasks }).success).toBe(false);
  for (const expectedMaxConcurrentTasks of [0, 1.5]) expect(SetQuotaRequestSchema.safeParse({ maxConcurrentTasks: 2, expectedMaxConcurrentTasks }).success).toBe(false);
});
