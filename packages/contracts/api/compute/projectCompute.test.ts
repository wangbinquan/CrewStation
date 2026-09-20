import { expect, test } from 'bun:test';
import { CreateComputeProfileRequestSchema } from './computeProfile';
import { ProjectComputePolicySchema, SaveProjectComputePolicySchema } from './projectCompute';

const policy = { mode: 'restricted' as const, allowedProfiles: ['01a0bf5d-8f4b-7115-8dc3-606fbf8691fb'], defaultProfile: '01a0bf5d-8f4b-7115-8dc3-606fbf8691fb', devTaskProfile: '01a0bf5d-8f4b-7f2b-8caf-3349046050a1' };
test('项目算力策略明确表达继承、空授权及默认套餐，不接受重复或越界默认档位', () => {
  expect(ProjectComputePolicySchema.parse(policy)).toEqual(policy);
  expect(ProjectComputePolicySchema.parse({ mode: 'inherit', allowedProfiles: [], defaultProfile: null, devTaskProfile: null }).mode).toBe('inherit');
  expect(ProjectComputePolicySchema.parse({ ...policy, allowedProfiles: [], defaultProfile: null }).allowedProfiles).toEqual([]);
  for (const patch of [{ defaultProfile: '01a0bf5d-8f4b-7d92-898a-10d1b0735837' }, { allowedProfiles: ['01a0bf5d-8f4b-7115-8dc3-606fbf8691fb', '01a0bf5d-8f4b-7115-8dc3-606fbf8691fb'] }, { allowedProfiles: Array.from({ length: 201 }, () => Bun.randomUUIDv7()), defaultProfile: null }, { mode: 'inherit' }, { extra: true }, { defaultProfile: 'default' }]) {
    expect(ProjectComputePolicySchema.safeParse({ ...policy, ...patch }).success).toBe(false);
  }
  expect(SaveProjectComputePolicySchema.safeParse({ policy, expectedRevision: 0 }).success).toBe(true);
  for (const input of [{ policy }, { policy, expectedRevision: -1 }, { policy, expectedRevision: 0, projectId: '01a0bf5d-8f4b-7d92-898a-10d1b0735837' }]) expect(SaveProjectComputePolicySchema.safeParse(input).success).toBe(false);
});


test('档位默认可见性只接受布尔值，省略时由创建用例继承兼容默认', () => {
  const input = { name: 'private', content: { image: 'runtime/agent:v1', launch: { protocol: 'opencode', binaryPath: '/opt/agent' } } };
  expect(CreateComputeProfileRequestSchema.parse(input).defaultVisible).toBeUndefined();
  expect(CreateComputeProfileRequestSchema.parse({ ...input, defaultVisible: false }).defaultVisible).toBe(false);
  expect(CreateComputeProfileRequestSchema.safeParse({ ...input, defaultVisible: 'false' }).success).toBe(false);
  expect(CreateComputeProfileRequestSchema.safeParse({ ...input, defaultVisible: false, isDefault: true }).success).toBe(false);
});
