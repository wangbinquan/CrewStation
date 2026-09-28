import { expect, test } from 'bun:test';
import { readTopologyResources } from '../shared/topology/readTopologyResources';

test('system resource pagination pins the snapshot and advertises bounded reads', async () => {
  const seen: unknown[] = [];
  const result = await readTopologyResources({ scope: 'system' }, async (q) => { seen.push(q); return { items: [], total: 3000, snapshotId: 'fixed', complete: true, nextCursor: 'next' }; });
  expect(seen).toHaveLength(20); expect(seen[1]).toMatchObject({ snapshotId: 'fixed', cursor: 'next' });
  expect(result).toMatchObject({ complete: false, truncated: true });
});

test('a failed source remains incomplete even when subsequent pages are complete', async () => {
  let calls = 0;
  const result = await readTopologyResources({ scope: 'system', snapshotId: 'fixed' }, async () => ({ items: [], total: 101, snapshotId: 'fixed', complete: ++calls > 1, ...(calls === 1 ? { nextCursor: 'next' } : {}) }));
  expect(calls).toBe(2); expect(result).toMatchObject({ complete: false, truncated: false });
});
