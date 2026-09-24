import { describe, expect, test } from 'bun:test';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';
import { changedDataRecords, newDataObservationStats, observeDataRecord } from './observeDataPlane';

const view = (id: string, kind: string): DataRecordView => ({ id, kind, spec: { children: [{ kind: 'PostgresRole', name: `cs_${id}` }] }, children: [] });

function fakeLedger(records: readonly DataRecordView[], outcome: 'recorded' | 'unchanged' | 'unowned' = 'recorded') {
  const reads: string[] = [], observed: string[] = [];
  const ledger: DataLedgerObservations = {
    get: async (id) => { reads.push(id); return records.find((record) => record.id === id); },
    listLive: async () => records, changesSince: async () => [], latestChange: async () => 0,
    observe: async ({ resourceId, child, gone }) => { observed.push(`${resourceId}:${child.name}:${gone ? 'gone' : child.phase}`); return { status: outcome }; },
  };
  return { ledger, reads, observed };
}

describe('数据面观测的用例（RFC-025 第四期）', () => {
  test('台账有变化的记录里只挑数据库与访问绑定；同一条只读一次；读不到的跳过', async () => {
    const fake = fakeLedger([view('a', 'database'), view('b', 'network-policy-set'), view('c', 'data-binding')]);
    const records = await changedDataRecords(fake.ledger, ['a', 'b', 'a', 'c', 'missing']);
    expect(records.map((record) => record.id)).toEqual(['a', 'c']);
    expect(fake.reads).toEqual(['a', 'b', 'c', 'missing']);
  });

  test('按记录写观测：计数按台账的结果；只数写了的', async () => {
    const snapshot = { databases: new Map(), roles: new Map([['cs_a', { name: 'cs_a', oid: '1' }]]), observedAt: '2026-09-24T00:00:00.000Z' };
    const stats = newDataObservationStats();
    const fake = fakeLedger([]);
    expect(await observeDataRecord(fake.ledger, snapshot, stats, view('a', 'data-binding'))).toBe(1);
    expect(fake.observed).toEqual(['a:cs_a:Present']);
    const unchanged = fakeLedger([], 'unchanged');
    expect(await observeDataRecord(unchanged.ledger, snapshot, stats, view('a', 'data-binding'))).toBe(0);
    expect(stats).toEqual({ recorded: 1, unchanged: 1, unowned: 0, removed: 0 });
  });
});
