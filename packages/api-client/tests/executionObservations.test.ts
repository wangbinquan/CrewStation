import { expect, test } from 'bun:test';
import { createApiClient, type FetchLike } from '../index';

test('execution observation queries preserve independent snapshot and incremental cursors', async () => {
  const calls: URL[] = [];
  const fetch: FetchLike = async (raw) => { calls.push(new URL(String(raw), 'http://client.test')); return Response.json({ items: [] }); };
  const api = createApiClient({ fetch }).observability;
  await api.executionObservations('task /one');
  await api.executionObservations('task /one', { after: 'usage-v1:scope:7', limit: 10 });
  await api.executionObservations('task /one', { snapshot: 'true', snapshotId: 'snapshot-1', cursor: 'last-meter', limit: 2 });
  expect(calls.map((url) => url.pathname)).toEqual(Array(3).fill('/v3/business-tasks/task%20%2Fone/observations'));
  expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({});
  expect(Object.fromEntries(calls[1]!.searchParams)).toEqual({ after: 'usage-v1:scope:7', limit: '10' });
  expect(Object.fromEntries(calls[2]!.searchParams)).toEqual({ snapshot: 'true', snapshotId: 'snapshot-1', cursor: 'last-meter', limit: '2' });
});

test('project cost visibility uses its own CAS write without mutating prices', async () => {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const fetch: FetchLike = async (raw, init) => {
    calls.push({ method: init?.method ?? 'GET', path: String(raw), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ visibility: 'hidden', revision: 4 });
  };
  const api = createApiClient({ fetch }).observability;
  expect(await api.executionCostVisibility('project /one')).toMatchObject({ revision: 4 });
  const body = { expectedRevision: 4, requestKey: 'cost-request', visibility: 'project-members-and-services' as const };
  await api.setExecutionCostVisibility('project /one', body);
  expect(calls).toEqual([
    { method: 'GET', path: '/v1/admin/observability/projects/project%20%2Fone/cost-visibility', body: null },
    { method: 'PUT', path: '/v1/admin/observability/projects/project%20%2Fone/cost-visibility', body },
  ]);
});
