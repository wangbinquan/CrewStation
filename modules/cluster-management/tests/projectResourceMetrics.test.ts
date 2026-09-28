// RFC-034: project resource summaries and history reuse owner samples without losing scope or identity.
import { expect, test } from 'bun:test';
import { IDENTITY_HEADERS, ProjectResourceMetricsQuerySchema, ProjectResourceMetricsSchema, ProjectResourceHistoryQuerySchema } from '@crewstation/contracts';
import { createApp } from '@crewstation/http';
import { metricsRoutes } from '../http/metricsRoutes';
import { metricQueries } from '../application/metricQueries';
import { observeMetrics } from '../application/observeMetrics';
import { metricsFixture, metricsTicket } from './metricsFixture';
import { admin } from './inventoryFixture';

async function fixture() {
  const f = metricsFixture(); await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
  f.advance(); await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
  const projectId = f.observation().usages.find((row) => row.scope === 'project')!.projectId!, authorized: string[] = [], expressions: string[] = [];
  const api = metricQueries(f.deps, async () => true, { range: async (expression) => { expressions.push(expression); return []; } }, async (_actor, id) => { authorized.push(id); });
  return { ...f, projectId, authorized, expressions, api };
}
test('project page pins its source snapshot, total and summary while retaining original Pod and PVC UIDs', async () => {
  const f = await fixture(), rows = f.observation().usages.filter((row) => row.projectId === f.projectId), seen: string[] = [];
  const first = await f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 1 });
  ProjectResourceMetricsSchema.parse(first); expect(first.total).toBe(rows.length); expect(first.summary.pods).toBe(2); expect(first.summary.pvcs).toBe(1);
  let page = first;
  do {
    expect(page.total).toBe(first.total); expect(page.summary).toEqual(first.summary);
    for (const item of page.items) { seen.push(item.uid); expect(Object.keys(item).sort()).toEqual(['resourceId', 'uid', 'kind', 'namespace', 'name', 'phase', 'metrics'].sort()); }
    if (page.nextCursor === undefined) break;
    page = await f.api.projectUsage(admin, f.projectId, { observationId: first.observationId, cursor: page.nextCursor, limit: 1 });
  } while (true);
  expect(seen.sort()).toEqual(rows.map((r) => r.uid).sort()); expect(f.authorized.every((id) => id === f.projectId)).toBe(true);
  const empty = await f.api.projectUsage(admin, '01a0c000-0000-7000-8000-000000000099', { cursor: 0, limit: 10 });
  expect(empty.total).toBe(0); expect(empty.summary.pods).toBe(0); expect(empty.summary.pvcs).toBe(0);
});
test('project source failures and expired pages remain errors; freshness never changes the original observation time', async () => {
  const f = await fixture(), first = await f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 1 });
  f.advance(200_000); const stale = await f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 100 });
  expect(stale.observedAt).toBe(first.observedAt); expect(stale.items.find((row) => row.name === 'app')!.metrics.cpu?.state).toBe('stale'); expect(stale.summary.coverage.cpu?.fresh).toBe(0); expect(stale.summary.coverage.cpu?.complete).toBe(false);
  f.advance(401_000); await expect(f.api.projectUsage(admin, f.projectId, { observationId: first.observationId, cursor: 1, limit: 1 })).rejects.toMatchObject({ details: { status: 410 } });
  f.deps.repository.latest = async () => { throw new Error('sample store failed'); };
  await expect(f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 100 })).rejects.toThrow('sample store failed');
});
test('project history forces the project series and preserves missing samples, with the existing seven day contract', async () => {
  const f = await fixture(), to = f.deps.clock.now().toISOString(), from = new Date(Date.parse(to) - 3600000).toISOString();
  const query = ProjectResourceHistoryQuerySchema.parse({ from, to, metrics: 'cpu,memory,volumeUsed' });
  const result = await f.api.projectHistory(admin, f.projectId, query);
  expect(result.state).toBe('fresh'); expect(result.series).toHaveLength(3); expect(result.series[0]!.points.every((p) => p.average === null && !p.complete)).toBe(true);
  expect(f.expressions.every((s) => s.includes('scope="project"') && s.includes(`project_id="${f.projectId}"`))).toBe(true);
  expect(ProjectResourceHistoryQuerySchema.safeParse({ from: new Date(Date.parse(to) - 8 * 86400000).toISOString(), to }).success).toBe(false);
  expect(ProjectResourceMetricsQuerySchema.safeParse({ cursor: 1 }).success).toBe(false);
  expect(ProjectResourceMetricsQuerySchema.safeParse({ cursor: 1, observationId: 'snapshot' }).success).toBe(true);
});

test('empty previous project sample followed by topology failure is partial, with its original sample time', async () => {
  const f = await fixture(); f.observation().usages = [];
  const first = await f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 100 });
  expect(first.complete).toBe(true); expect(first.total).toBe(0);
  f.deps.reader.topology = async () => { throw new Error('Topology read failed'); }; f.advance();
  await observeMetrics(f.deps, metricsTicket, new AbortController().signal);
  const failed = await f.api.projectUsage(admin, f.projectId, { cursor: 0, limit: 100 });
  expect(failed.complete).toBe(false); expect(failed.state).toBe('error'); expect(failed.observedAt).toBe(first.observedAt);
});
test('project HTTP rejects empty snapshot IDs and returns typed current-scope pages and history', async () => {
  const f = await fixture(), app = createApp({ name: 'project-observation-test' }); app.route('/', metricsRoutes(f.api, async () => true));
  const headers = { [IDENTITY_HEADERS.userId]: admin.userId };
  const path = `/v1/projects/${f.projectId}/cluster-usage`;
  expect(ProjectResourceMetricsQuerySchema.safeParse({ cursor: 1, observationId: '' }).success).toBe(false);
  expect((await app.request(path + '?cursor=1&observationId=', { headers })).status).toBe(400);
  const response = await app.request(path + '?limit=1', { headers }); expect(response.status).toBe(200);
  const data = ProjectResourceMetricsSchema.parse(await response.json()); expect(data.items).toHaveLength(1); expect(data.complete).toBe(true);
  expect((await app.request(path + `?cursor=1&observationId=${data.observationId}`, { headers })).status).toBe(200);
  const history = await app.request(`/v1/projects/${f.projectId}/cluster-history?from=2026-09-21T09:00:00.000Z&to=2026-09-21T10:00:00.000Z&metrics=cpu`, { headers });
  expect(history.status).toBe(200);
});
