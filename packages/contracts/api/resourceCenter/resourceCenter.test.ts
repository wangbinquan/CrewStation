import { expect, test } from 'bun:test';
import { ResourceTargetSchema, ResourceValuesSchema } from './actions';
import { CreateResourceRequestSchema, DecideResourceRequestSchema, ResourceRequestQuerySchema, ResourceRequestVersionSchema } from './requests';
import { NamespaceQuotaSchema, SaveProjectNamespaceQuotaSchema } from './namespaceQuota';
import { SaveResourceCatalogPolicySchema } from './catalog';
import { ResourceQuotaMetricSchema } from './snapshot';

const target = { resourceType: 'namespace-quota', resourceId: 'project-quota', action: 'set-quota' };
const create = { target, expectedRevision: 'r1', values: { requestsCpu: 4 }, reason: '  增加开发空间额度  ', requestKey: 'request-key-1' };

test('资源写合同拒绝未知键和未版本化操作；理由修剪，申请与审批值独立', () => {
  expect(CreateResourceRequestSchema.parse(create).reason).toBe('增加开发空间额度');
  for (const body of [{ ...create, extra: true }, { ...create, reason: '短' }, { ...create, expectedRevision: '' }, { ...create, requestKey: 'key' }]) expect(CreateResourceRequestSchema.safeParse(body).success).toBe(false);
  expect(ResourceTargetSchema.safeParse({ ...target, admin: true }).success).toBe(false);
  const decide = { expectedVersion: 1, expectedRevision: 'r1', approve: true, values: { requestsCpu: 3 }, reason: '容量核对' };
  expect(DecideResourceRequestSchema.parse(decide).values).toEqual({ requestsCpu: 3 });
  expect(DecideResourceRequestSchema.safeParse({ ...decide, expectedVersion: 0 }).success).toBe(false);
  expect(ResourceRequestVersionSchema.safeParse({ expectedVersion: 1, values: {} }).success).toBe(false);
});
test('参数是有界有限值，拒绝嵌套配置、非有限数字和过量键', () => {
  expect(ResourceValuesSchema.parse({ count: 1, inherit: true, id: 'one', absent: null })).toEqual({ count: 1, inherit: true, id: 'one', absent: null });
  for (const value of [{ count: Infinity }, { count: NaN }, { configuration: { secret: 'value' } }, Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`key${i}`, i]))]) expect(ResourceValuesSchema.safeParse(value).success).toBe(false);
});
test('命名空间量纲、目录版本和分页默认值严格；未知指标保持未知而非零', () => {
  const quota = { requestsCpu: 0.5, requestsMemoryGiB: 0.125, pods: 1, persistentVolumeClaims: 0 };
  expect(NamespaceQuotaSchema.parse(quota)).toEqual(quota); expect(SaveProjectNamespaceQuotaSchema.parse({ expectedRevision: 0, quota }).quota.persistentVolumeClaims).toBe(0);
  for (const value of [{ ...quota, pods: 1.5 }, { ...quota, requestsCpu: 0 }, { ...quota, requestsMemoryGiB: Infinity }, { ...quota, limitsCpu: 1 }]) expect(NamespaceQuotaSchema.safeParse(value).success).toBe(false);
  expect(SaveResourceCatalogPolicySchema.safeParse({ requestable: true }).success).toBe(false); expect(SaveResourceCatalogPolicySchema.safeParse({ expectedRevision: 0, requestable: true, extra: true }).success).toBe(false);
  expect(ResourceRequestQuerySchema.parse({})).toEqual({ limit: 50 }); expect(ResourceRequestQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  const metric = { key: 'cpu', label: 'CPU', unit: '核', scopeId: 'project', used: null, reserved: null, limit: null, requestedLimit: 4, limitKind: 'unknown' as const, observedAt: null };
  expect(ResourceQuotaMetricSchema.parse(metric)).toEqual(metric);
});
