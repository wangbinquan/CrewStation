import { expect, test } from 'bun:test';
import { objectStorageHistory } from './objectStorageHistory';
const backendId = Bun.randomUUIDv7(), spaceId = Bun.randomUUIDv7(), end = 1790553600;

test('object history keeps measured zero distinct from gaps and scopes all tenant series', async () => {
  const queries: string[] = [];
  const read = objectStorageHistory({ range: async (query) => {
    queries.push(query);
    if (query.includes('dropped')) return [];
    if (query.includes('timestamp')) return [{ metric: {}, values: [[end, String(end)]] }];
    if (query.includes('histogram_quantile')) return [];
    return [{ metric: {}, values: [[end - 30, '0'], [end, query.includes('operation="get"') ? '1024' : '0']] }];
  } }, true, () => new Date(end * 1000));
  const value = await read({ backendId, spaceId, window: '1h' });
  expect(value.stale).toBe(false); expect(value.samples.at(-1)).toMatchObject({ readBytesPerSecond: 1024, writeBytesPerSecond: 0, p95Seconds: null });
  expect(value.samples.at(-2)).toMatchObject({ readBytesPerSecond: null, writeBytesPerSecond: null });
  expect(queries.filter((q) => !q.includes('dropped')).every((q) => q.includes(`space_id="${spaceId}"`) && q.includes(`backend_id="${backendId}"`))).toBe(true);
  expect(value.samples.length).toBeLessThanOrEqual(1024);
});
test('disabled, absent, failed, stale and capacity-limited observations never become fresh zero graphs', async () => {
  const request = { backendId, window: '7d' as const }, clock = () => new Date(end * 1000);
  expect(await objectStorageHistory({ range: async () => [] }, false, clock)(request)).toMatchObject({ stale: true, observedAt: null, samples: [] });
  expect(await objectStorageHistory({ range: async () => [] }, true, clock)(request)).toMatchObject({ stale: true, observedAt: null, samples: [] });
  expect((await objectStorageHistory({ range: async () => { throw new Error('private endpoint'); } }, true, clock)(request)).unavailableReason).not.toContain('private');
  const stale = objectStorageHistory({ range: async (q) => q.includes('timestamp') ? [{ metric: {}, values: [[end, String(end - 300)]] }] : [] }, true, clock);
  expect((await stale(request)).stale).toBe(true);
  const limited = objectStorageHistory({ range: async (q) => [{ metric: {}, values: [[end, q.includes('timestamp') ? String(end) : q.includes('dropped') ? '1' : '0']] }] }, true, clock);
  expect((await limited(request)).unavailableReason).toContain('不完整');
  await expect(limited({ ...request, backendId: 'x"} or secret' })).rejects.toThrow();
});
