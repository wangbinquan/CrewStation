import { describe, expect, test } from 'bun:test';
import { noopLogger } from '@crewstation/kernel';
import { newDataObservationStats } from '../application/observeDataPlane';
import type { DataPlaneReader } from '../ports/dataPlane';
import type { DataLedgerObservations, DataRecordView } from '../ports/ledger';
import { dataPlaneObserver } from './dataPlaneObserver';

const record: DataRecordView = { id: 'db-1', kind: 'database', spec: { children: [{ kind: 'PostgresDatabase', name: 'cs_demo' }] }, children: [] };
const reader = (): DataPlaneReader & { closed: boolean } => {
  const self = {
    closed: false,
    snapshot: async () => ({ databases: new Map([['cs_demo', { name: 'cs_demo', oid: '1' }]]), roles: new Map(), observedAt: '2026-09-24T00:00:00.000Z' }),
    close: async () => { self.closed = true; },
  };
  return self;
};

async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!check()) { if (Date.now() > deadline) throw new Error('等待超时'); await Bun.sleep(5); }
}

describe('数据面观测的节奏（RFC-025 第四期）', () => {
  test('全量核对写了观测就记一行（库数、角色数、写了几条）；没有新写入不记', async () => {
    const infos: { msg: string; fields: unknown }[] = [];
    let outcome: 'recorded' | 'unchanged' = 'recorded';
    const ledger: DataLedgerObservations = {
      get: async () => record, listLive: async () => [record], changesSince: async () => [], latestChange: async () => 7,
      observe: async () => ({ status: outcome }),
    };
    const plane = reader();
    const observer = dataPlaneObserver(ledger, plane, newDataObservationStats(), { ...noopLogger, info: (msg: string, fields?: unknown) => { infos.push({ msg, fields }); } }, { pollMs: 1_000_000, resyncMs: 10 });
    observer.start();
    await until(() => infos.length > 0);
    outcome = 'unchanged';
    const logged = infos.length;
    await Bun.sleep(40);
    await observer.stop();
    expect(infos[0]).toEqual({ msg: 'data plane observed', fields: { records: 1, recorded: 1, databases: 1, roles: 0 } });
    expect(infos.length - logged).toBeLessThanOrEqual(1);
    expect(plane.closed).toBe(true);
  });

  test('尾随台账变更：从启动时的游标起，只核对数据库与访问绑定，一批取一份快照；台账读失败只告警、下一拍再来', async () => {
    const warnings: string[] = [];
    const observed: string[] = [];
    let snapshots = 0, fail = true;
    const other: DataRecordView = { id: 'np-1', kind: 'network-policy-set', spec: { children: [] }, children: [] };
    const ledger: DataLedgerObservations = {
      get: async (id) => (id === record.id ? record : other), listLive: async () => [], latestChange: async () => 7,
      changesSince: async (cursor) => {
        if (fail) { fail = false; throw new Error('台账暂时不可用'); }
        return cursor === 7 ? [{ seq: 8, resourceId: record.id }, { seq: 9, resourceId: other.id }] : [];
      },
      observe: async ({ resourceId, child }) => { observed.push(`${resourceId}:${child.name}`); return { status: 'recorded' }; },
    };
    const plane = reader();
    const counting: DataPlaneReader = { snapshot: async () => { snapshots += 1; return plane.snapshot(); }, close: plane.close };
    const observer = dataPlaneObserver(ledger, counting, newDataObservationStats(), { ...noopLogger, warn: (msg: string) => { warnings.push(msg); } }, { pollMs: 5, resyncMs: 1_000_000 });
    observer.start();
    await until(() => observed.includes('db-1:cs_demo') && warnings.includes('data plane tail failed'));
    await Bun.sleep(30);
    await observer.stop();
    // 全量那一拍在启动时跑过一次（台账里没有在册记录，也取了一份快照），尾随的那批只取一份。
    expect(snapshots).toBe(2);
    expect(observed.filter((entry) => entry.startsWith('np-1'))).toEqual([]);
  });
});
