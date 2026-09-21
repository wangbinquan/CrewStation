import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveCapability } from '@crewstation/testkit';
import { ClusterHistoryQuerySchema } from '@crewstation/contracts';
import { prometheusHistoryReader } from '../adapters/http/prometheus';
import { queryHistory } from '../application/historyQueries';
import { metricsFixture } from './metricsFixture';

const prometheus = process.env.CS_TEST_PROMETHEUS_BIN ?? Bun.which('prometheus'), promtool = process.env.CS_TEST_PROMTOOL_BIN ?? Bun.which('promtool');
const available = resolveCapability('prometheus', !!prometheus && !!promtool, 'Set CS_TEST_PROMETHEUS_BIN and CS_TEST_PROMTOOL_BIN to the pinned Prometheus 3.13.3 binaries');
let directory = '', processHandle: ReturnType<typeof Bun.spawn> | undefined, url = '', serverLogs = '';
const resourceId = '01a0bf5d-8f4b-7178-82e1-9a99060b1192';
const now = Math.floor(Date.now() / 15_000) * 15_000, atSevenDays = now / 1000 - 7 * 86400 + 600;
async function command(args: string[]) {
  const child = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  if (code) throw new Error(`Prometheus test command failed: ${stderr}`); return stdout;
}
async function startPrometheus() {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('reserved') }), port = reservation.port; await reservation.stop(true);
  url = `http://127.0.0.1:${port}`;
  processHandle = Bun.spawn([prometheus!, `--config.file=${join(directory, 'prometheus.yml')}`, `--web.config.file=${join(directory, 'web.yml')}`, `--storage.tsdb.path=${join(directory, 'data')}`, '--storage.tsdb.retention.time=8d', `--web.listen-address=127.0.0.1:${port}`, '--log.level=info'], { stdout: 'ignore', stderr: 'pipe' });
  const ready = Promise.withResolvers<void>(), deadline = setTimeout(() => ready.reject(new Error(`Prometheus readiness timeout: ${serverLogs.slice(-1000)}`)), 15_000);
  const stderr = processHandle.stderr as ReadableStream<Uint8Array>;
  void (async () => { for await (const chunk of stderr) { serverLogs += new TextDecoder().decode(chunk); if (serverLogs.includes('Server is ready to receive web requests')) ready.resolve(); } })().catch(ready.reject);
  try { await Promise.race([ready.promise, processHandle.exited.then((code) => { throw new Error(`Prometheus exited ${code}: ${serverLogs}`); })]); } finally { clearTimeout(deadline); }
}
beforeAll(async () => {
  if (!available) return;
  directory = await mkdtemp(join(tmpdir(), 'cs-prometheus-history-')); await mkdir(join(directory, 'data'));
  await writeFile(join(directory, 'prometheus.yml'), 'global:\n  scrape_interval: 15s\nscrape_configs: []\n');
  await writeFile(join(directory, 'web.yml'), `basic_auth_users:\n  crewstation: ${await Bun.password.hash('history-test', { algorithm: 'bcrypt', cost: 4 })}\n`);
  const labels = 'scope="cluster",metric="cpu",resource_id="",uid="",project_id="",container="",device="",interface=""';
  const dates = [now / 1000 - 9 * 86400, ...Array.from({ length: 10 }, (_, i) => atSevenDays + i * 15), ...Array.from({ length: 8 }, (_, i) => now / 1000 - 120 + i * 15)];
  const lines: string[] = [];
  for (const metric of ['cs_cluster_value', 'cs_cluster_source_timestamp_seconds', 'cs_cluster_coverage']) {
    lines.push(`# TYPE ${metric} gauge`);
    for (const at of dates) {
      const stale = at === now / 1000 - 60, value = metric === 'cs_cluster_value' ? stale ? 999 : 2 : metric === 'cs_cluster_coverage' ? 1 : stale ? at - 600 : at;
      lines.push(`${metric}{${labels}} ${value} ${at}`);
    }
    for (let i = 0; i < 8; i++) {
      const at = now / 1000 - 120 + i * 15, owner = i < 4 ? 'old' : 'new';
      const identity = `scope="pod",metric="cpu",resource_id="${resourceId}",uid="pod-uid",project_id="${owner}",container="",device="",interface=""`;
      lines.push(`${metric}{${identity}} ${metric === 'cs_cluster_value' ? i < 4 ? 9 : 3 : metric === 'cs_cluster_coverage' ? 1 : at} ${at}`);
    }
  }
  lines.push('# EOF'); await writeFile(join(directory, 'samples.txt'), `${lines.join('\n')}\n`);
  await command([promtool!, 'tsdb', 'create-blocks-from', 'openmetrics', join(directory, 'samples.txt'), join(directory, 'data')]);
  await startPrometheus();
}, 60_000);
afterAll(async () => { if (processHandle) { processHandle.kill('SIGTERM'); await processHandle.exited; } if (directory) await rm(directory, { recursive: true, force: true }); });
describe.skipIf(!available)('isolated real Prometheus seven-day history', () => {
  test('fixed production query templates read seven-day data, preserve gaps and reject stale repeated gauges', async () => {
    const f = metricsFixture(); f.deps.clock = { now: () => new Date(now) };
    const reader = prometheusHistoryReader(url, 'history-test'), query = ClusterHistoryQuerySchema.parse({ scope: 'cluster', metrics: 'cpu', from: new Date(now - 7 * 86400_000).toISOString(), to: new Date(now).toISOString() });
    const history = await queryHistory(f.deps, reader, query); expect(history.reason).toBeUndefined(); expect(history.state).toBe('fresh'); expect(history.series[0]?.points).toHaveLength(1008);
    expect(history.series[0]?.points.some((p) => p.average === 2)).toBe(true); expect(history.series[0]?.points.some((p) => p.average === null && p.coverage === 0)).toBe(true); expect(history.series[0]?.points.some((p) => (p.peak ?? 0) > 2)).toBe(false);
    expect(history.availableFrom).toBe(new Date(atSevenDays * 1000).toISOString());
    const short = await queryHistory(f.deps, reader, { ...query, from: new Date(now - 120_000).toISOString() }); expect(short.series[0]?.points).toHaveLength(8); expect(short.series[0]?.points.some((p) => !p.complete)).toBe(true);
  }, 30_000);
  test('a stable UID keeps one continuous history when ownership labels change', async () => {
    const f = metricsFixture(); f.deps.clock = { now: () => new Date(now) };
    f.deps.repository.identities = async () => [{ resourceId, uid: 'pod-uid', kind: 'Pod', name: 'renamed', namespace: 'qa', scope: 'project', firstSeen: new Date(now - 120_000).toISOString(), lastSeen: new Date(now).toISOString(), deleted: true, versions: [] }];
    const history = await queryHistory(f.deps, prometheusHistoryReader(url, 'history-test'), { scope: 'pod', resourceId, metrics: ['cpu'], from: new Date(now - 120_000).toISOString(), to: new Date(now).toISOString() });
    expect(history.reason).toBeUndefined(); expect(history.state).toBe('fresh');
    const values = history.series[0]!.points.map((p) => p.average);
    expect(values).toContain(9); expect(values).toContain(3);
    expect(history.series[0]!.points.every((p) => (p.peak ?? 0) <= 9)).toBe(true);
    expect(history.availableFrom).toBe(new Date(now - 120_000).toISOString());
  });
  test('eight-day buffer actually removes expired TSDB blocks and a restart retains the valid history', async () => {
    const data = join(directory, 'data'), names = (await readdir(data)).filter((name) => /^[0-9A-Z]{26}$/.test(name));
    const metadata = await Promise.all(names.map(async (name) => JSON.parse(await readFile(join(data, name, 'meta.json'), 'utf8')) as { minTime: number; maxTime: number }));
    expect(metadata.length).toBeGreaterThan(0); expect(metadata.every((m) => m.maxTime > now - 8 * 86400_000)).toBe(true);
    processHandle!.kill('SIGTERM'); await processHandle!.exited; processHandle = undefined; serverLogs = ''; await startPrometheus();
    const reader = prometheusHistoryReader(url, 'history-test'), result = await reader.range('cs_cluster_value{scope="cluster",metric="cpu"}', atSevenDays, atSevenDays + 30, 15, new AbortController().signal);
    expect(result[0]?.values.length).toBe(3); expect(result[0]?.values[0]?.[1]).toBe('2');
    const denied = await fetch(`${url}/api/v1/query?query=up`); expect(denied.status).toBe(401);
  }, 30_000);
});
