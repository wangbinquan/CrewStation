import { describe, expect, test } from 'bun:test';
import type { ResourceChild } from '@crewstation/contracts';
import type { DataPlaneSnapshot } from './dataPlane';
import { dataObservations } from './dataPlane';

const at = '2026-09-24T01:00:00.000Z';
const snapshot = (databases: [string, string][], roles: [string, string, string?][]): DataPlaneSnapshot => ({
  databases: new Map(databases.map(([name, oid]) => [name, { name, oid }])),
  roles: new Map(roles.map(([name, oid, validUntil]) => [name, { name, oid, ...(validUntil ? { validUntil } : {}) }])),
  observedAt: at,
});
const spec = { children: [{ kind: 'PostgresDatabase', name: 'cs_demo' }, { kind: 'PostgresRole', name: 'cs_demo' }] };

describe('数据面观测（RFC-025 第四期）', () => {
  test('库与角色都在：各一条在的观测，OID 当 UID', () => {
    expect(dataObservations({ spec, children: [] }, snapshot([['cs_demo', '16390']], [['cs_demo', '16389']]))).toEqual([
      { child: { kind: 'PostgresDatabase', name: 'cs_demo', uid: '16390', phase: 'Present', ready: true, observedAt: at }, gone: false },
      { child: { kind: 'PostgresRole', name: 'cs_demo', uid: '16389', phase: 'Present', ready: true, observedAt: at }, gone: false },
    ]);
  });

  test('不在：台账记着在的报消失（带原来的 UID），从没观测到的不报；期望里已经没有、却还记着在的也核对', () => {
    const recorded: ResourceChild[] = [
      { kind: 'PostgresDatabase', name: 'cs_demo', uid: '16390', phase: 'Present', ready: true },
      { kind: 'PostgresRole', name: 'cs_demo', phase: 'absent', ready: false },
      { kind: 'PostgresRole', name: 'cs_t_old', uid: '17001', phase: 'Present', ready: true },
    ];
    expect(dataObservations({ spec, children: recorded }, snapshot([], []))).toEqual([
      { child: { kind: 'PostgresDatabase', name: 'cs_demo', uid: '16390', phase: 'absent', ready: false }, gone: true },
      { child: { kind: 'PostgresRole', name: 'cs_t_old', uid: '17001', phase: 'absent', ready: false }, gone: true },
    ]);
  });

  test('临时角色过了 VALID UNTIL：还在，记 Expired、未就绪；没到期的照常；不认识的子对象种类不管', () => {
    const binding = { spec: { children: [{ kind: 'PostgresRole', name: 'cs_t_1' }, { kind: 'Pod', namespace: 'cs-demo', name: 'x' }] }, children: [] };
    expect(dataObservations(binding, snapshot([], [['cs_t_1', '17002', '2026-09-24T00:59:59.000Z']]))[0]?.child).toMatchObject({ phase: 'Expired', ready: false });
    const later = dataObservations(binding, snapshot([], [['cs_t_1', '17002', '2026-09-24T02:00:00.000Z']]));
    expect(later).toHaveLength(1);
    expect(later[0]?.child).toMatchObject({ phase: 'Present', ready: true });
  });
});
