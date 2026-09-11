import { describe, expect, test } from 'bun:test';
import type { ProjectId, UserId } from '@crewstation/contracts';
import { recordHit } from './blockedRecord';
import { mergePolicy, newEgressEntry } from './egressEntry';
import type { EgressRequest } from './egressRequest';
import { decideRequest } from './egressRequest';

const projectId = 'prj_00000000000000000000000000000001' as ProjectId;
const userId = 'usr_00000000000000000000000000000001' as UserId;
const now = new Date('2026-09-11T00:00:00Z');

describe('egress domain', () => {
  test('条目：作用域与 projectId 一致；FQDN 规范化并校验', () => {
    expect(newEgressEntry({ id: 'e1', fqdn: 'API.Example.com.', scope: 'global', createdBy: userId, createdAt: now })).toMatchObject({ fqdn: 'api.example.com' });
    expect(() => newEgressEntry({ id: 'e2', fqdn: 'x.example.com', scope: 'project', createdBy: userId, createdAt: now })).toThrow('projectId');
    expect(() => newEgressEntry({ id: 'e3', fqdn: 'x.example.com', scope: 'global', projectId, createdBy: userId, createdAt: now })).toThrow('projectId');
    expect(() => newEgressEntry({ id: 'e4', fqdn: 'localhost', scope: 'global', createdBy: userId, createdAt: now })).toThrow('FQDN');
    expect(() => newEgressEntry({ id: 'e5', fqdn: 'a_b.example.com', scope: 'global', createdBy: userId, createdAt: now })).toThrow('FQDN');
  });

  test('放行清单去重排序', () => {
    const entry = (fqdn: string) => newEgressEntry({ id: fqdn, fqdn, scope: 'global', createdBy: userId, createdAt: now });
    expect(mergePolicy([entry('b.example.com'), entry('a.example.com'), entry('b.example.com')])).toEqual(['a.example.com', 'b.example.com']);
  });

  test('申请只能从 pending 裁定一次', () => {
    const pending: EgressRequest = { id: 'r1', projectId, fqdn: 'api.github.com', state: 'pending', requestedBy: userId, createdAt: now };
    const approved = decideRequest(pending, true, userId, 'ok', now);
    expect(approved).toMatchObject({ state: 'approved', decidedBy: userId, decision: 'ok', decidedAt: now });
    expect(decideRequest(pending, false, userId, undefined, now)).toMatchObject({ state: 'rejected' });
    expect(() => decideRequest(approved, false, userId, undefined, now)).toThrow('approved');
  });

  test('被阻记录累加计数并保留最近来源', () => {
    const first = recordHit(undefined, projectId, 'Blocked.Example.com', 'dev-session', now);
    expect(first).toMatchObject({ fqdn: 'blocked.example.com', count: 1, source: 'dev-session' });
    const second = recordHit(first, projectId, 'blocked.example.com', undefined, now);
    expect(second).toMatchObject({ count: 2, source: 'dev-session' });
    expect(recordHit(second, projectId, 'blocked.example.com', 'build', now)).toMatchObject({ count: 3, source: 'build' });
  });
});
