import { expect, test } from 'bun:test';
import type { UserId } from '@crewstation/contracts';
import type { AccessRequest } from './accessRequest';
import { decideAccessRequest } from './accessRequest';
import type { AppAccessFacts } from './appAccess';
import { acceptsRequests, canUseApp } from './appAccess';

const worker: AppAccessFacts = { kind: 'DigitalWorker', ownerIsUser: false, role: undefined, mode: 'members', allowRequests: true };

test('正式地址使用权：「项目成员」范围只放管理员、负责人与任一成员角色（含「用户」），「全部登录用户」人人放行', () => {
  expect(canUseApp(worker, false)).toBe(false);
  expect(canUseApp(worker, true)).toBe(true);
  expect(canUseApp({ ...worker, ownerIsUser: true }, false)).toBe(true);
  for (const role of ['owner', 'developer', 'tester', 'user'] as const) expect(canUseApp({ ...worker, role }, false)).toBe(true);
  expect(canUseApp({ ...worker, mode: 'authenticated' }, false)).toBe(true);
});

test('接入容器没有可见范围：只给管理员与成员，库里残留的「全部登录用户」也不放宽；不接受申请', () => {
  const proxy: AppAccessFacts = { ...worker, kind: 'APIProxy', mode: 'authenticated' };
  expect(canUseApp(proxy, false)).toBe(false);
  expect(canUseApp({ ...proxy, role: 'developer' }, false)).toBe(true);
  expect(canUseApp(proxy, true)).toBe(true);
  expect(acceptsRequests(proxy)).toBe(false);
  expect(acceptsRequests({ kind: 'EventProducer', allowRequests: true })).toBe(false);
});

test('数字人按负责人的开关决定给不给「申请访问权限」', () => {
  expect(acceptsRequests(worker)).toBe(true);
  expect(acceptsRequests({ ...worker, allowRequests: false })).toBe(false);
});

test('申请只能裁决一次：批准或拒绝都记下裁决人、时间与意见，再裁决被拒', () => {
  const at = new Date('2026-09-24T08:00:00Z'), owner = '01900000-0000-7000-8000-000000000001' as UserId;
  const pending: AccessRequest = { id: 'r', projectId: 'p' as AccessRequest['projectId'], requestedBy: 'u' as UserId, state: 'pending', createdAt: at };
  const approved = decideAccessRequest(pending, true, owner, undefined, at);
  expect(approved).toMatchObject({ state: 'approved', decidedBy: owner, decidedAt: at });
  expect(approved.decision).toBeUndefined();
  expect(decideAccessRequest(pending, false, owner, '请走部门流程', at)).toMatchObject({ state: 'rejected', decision: '请走部门流程' });
  expect(() => decideAccessRequest(approved, false, owner, undefined, at)).toThrow('已经处理过');
});
