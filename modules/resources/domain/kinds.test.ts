import { expect, test } from 'bun:test';
import type { ResourceKind } from '@crewstation/contracts';
import { KIND_RULES, STABLE_KINDS } from './kinds';

// 调和器按期望渲染子对象的种类（cluster-control 的 APPLIERS）：集群管理据此禁用这些对象的「删除」（I29 裁定），两处要一致。
test('rendered kinds are exactly the ones the reconciler applies, and all of them are stable records', () => {
  const rendered = (Object.keys(KIND_RULES) as ResourceKind[]).filter((kind) => KIND_RULES[kind].rendered);
  expect(rendered.sort()).toEqual(['namespace', 'network-policy-set', 'rate-limit-policy', 'route']);
  expect(rendered.every((kind) => STABLE_KINDS.includes(kind))).toBe(true);
});
