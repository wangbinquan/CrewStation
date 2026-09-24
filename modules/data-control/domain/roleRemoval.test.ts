import { describe, expect, test } from 'bun:test';
import type { DataPlaneSnapshot } from './dataPlane';
import { roleRemovals } from './roleRemoval';

const snapshot: DataPlaneSnapshot = {
  databases: new Map(),
  roles: new Map([['cs_t_0123abcd', { name: 'cs_t_0123abcd', oid: '17001' }], ['cs_demo_t_1a2b3c4d', { name: 'cs_demo_t_1a2b3c4d', oid: '17002' }], ['cs_demo', { name: 'cs_demo', oid: '16389' }]]),
  observedAt: '2026-09-24T00:00:00.000Z',
};
const binding = (children: string[], extra: Record<string, unknown> = {}, desired: 'present' | 'absent' = 'absent') => ({
  kind: 'data-binding', desired, spec: { children: children.map((name) => ({ kind: 'PostgresRole', name })), database: 'cs_demo', ownerRole: 'cs_demo', ...extra },
});

describe('删访问绑定的临时角色（RFC-025 第四期）', () => {
  test('「不要了」的绑定：还在的临时角色按它的 OID 删，对象转给运行角色；已经不在的不删', () => {
    expect(roleRemovals(binding(['cs_t_0123abcd', 'cs_t_gone']), snapshot)).toEqual({ plans: [{ role: 'cs_t_0123abcd', oid: '17001', database: 'cs_demo', reassignTo: 'cs_demo' }], skipped: [] });
    expect(roleRemovals(binding(['cs_demo_t_1a2b3c4d']), snapshot).plans[0]?.role).toBe('cs_demo_t_1a2b3c4d');
  });

  test('还要的、不是绑定的、名字不像临时角色的（运行角色）、期望里没写库与运行角色的：不删', () => {
    expect(roleRemovals(binding(['cs_t_0123abcd'], {}, 'present'), snapshot).plans).toEqual([]);
    expect(roleRemovals({ ...binding(['cs_t_0123abcd']), kind: 'database' }, snapshot).plans).toEqual([]);
    expect(roleRemovals(binding(['cs_demo']), snapshot)).toEqual({ plans: [], skipped: ['cs_demo'] });
    expect(roleRemovals(binding(['cs_t_0123abcd'], { database: undefined }), snapshot)).toEqual({ plans: [], skipped: ['cs_t_0123abcd'] });
    expect(roleRemovals(binding(['cs_t_0123abcd'], { ownerRole: 'cs_t_0123abcd' }), snapshot).skipped).toEqual(['cs_t_0123abcd']);
  });
});
