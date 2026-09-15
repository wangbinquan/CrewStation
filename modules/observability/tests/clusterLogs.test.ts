import { describe, expect, test } from 'bun:test';
import { LogEntryDtoSchema } from '@crewstation/contracts';
import { createK8sClient } from '@crewstation/k8s';
import { kubernetesClusterObserver } from '../adapters/k8s/clusterObserver';

function fixture(logs: Record<string, string | number>, podStatus: Record<string, unknown> = {}) {
  const requests: URL[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/pods')) return Response.json({ items: Object.keys(logs).map((name) => ({ metadata: { name, namespace: 'cs-qa' }, status: podStatus[name] })) });
    const value = logs[url.pathname.split('/').at(-2)!];
    if (typeof value === 'number') return Response.json({ message: 'Pod 日志暂不可读' }, { status: value });
    return new Response(value ?? '');
  }) as typeof fetch;
  return { observer: kubernetesClusterObserver(createK8sClient({ server: 'https://k8s.invalid', defaultNamespace: 'cs-qa' }, fetcher)), requests };
}

describe('Kubernetes 日志事实', () => {
  test('尚未调度的构建明确给出等待原因，不显示尚无日志', async () => {
    const f = fixture({ 'build-waiting': '' }, { 'build-waiting': { phase: 'Pending', conditions: [
      { type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: '0/1 nodes are available: 1 Insufficient cpu.' },
    ] } });
    // 实机项目已 active，构建等待 CPU 时日志接口却返回空列表，管理员无法定位阻塞。
    await expect(f.observer.tailLogs('cs-qa', 'app.kubernetes.io/component=build', { tailLines: 200 })).rejects.toMatchObject({
      kind: 'unavailable', message: expect.stringContaining('Insufficient cpu'),
      details: { pod: 'build-waiting', reason: 'Unschedulable' },
    });
    expect(f.requests).toHaveLength(1);
  });

  test('未知调度说明如实保留，不能猜测成资源不足或构建失败', async () => {
    const f = fixture({ 'waiting-pod': '' }, { 'waiting-pod': { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'False' }] } });
    await expect(f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 })).rejects.toMatchObject({
      kind: 'unavailable', message: 'Pod waiting-pod 尚未调度，容器日志暂不可用；等待调度器提供原因。', details: { pod: 'waiting-pod' },
    });
  });

  test('已调度或正在运行的 Pod 继续读取真实日志，不按 Pending 字样推断失败', async () => {
    const f = fixture({ scheduled: '2026-09-15T06:30:00Z initializing\n', running: '2026-09-15T06:30:01Z ready\n' }, {
      scheduled: { phase: 'Pending', conditions: [{ type: 'PodScheduled', status: 'True' }] },
      running: { phase: 'Running', conditions: [{ type: 'PodScheduled', status: 'False', message: 'stale condition' }] },
    });
    const entries = await f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 });
    expect(entries.map((entry) => entry.message)).toEqual(['initializing', 'ready']);
    expect(f.requests).toHaveLength(3);
  });

  test('请求容器时间戳并保留固定故障时间，混合日志不标成 stdout', async () => {
    const f = fixture({ 'migrate-failed': '2026-09-14T13:59:54.295718172Z RFC003_MIGRATION_FAILURE\n' });
    const entries = await f.observer.tailLogs('cs-qa', 'crewstation.io/release=release-a', { tailLines: 200, sinceSeconds: 60 });
    // 实机失败迁移发生于 13:59:54，原接口却每次返回查询时间并声称 stdout。
    expect(Object.fromEntries(f.requests[1]!.searchParams)).toEqual({ timestamps: 'true', sinceSeconds: '60', tailLines: '200' });
    expect(f.requests[0]!.searchParams.get('labelSelector')).toBe('crewstation.io/release=release-a');
    expect(entries).toEqual([{ ts: '2026-09-14T13:59:54.295Z', source: 'slot', pod: 'migrate-failed', stream: 'combined', message: 'RFC003_MIGRATION_FAILURE' }]);
    expect(LogEntryDtoSchema.safeParse(entries[0]).success).toBe(true);
  });

  test('缺失或非法时间戳保留原文与未知时间，不把数字正文当日期', async () => {
    const lines = ['42 queued jobs', '2026-09-14 diagnostics', '2026-02-30T13:00:00Z invalid date', 'RFC003_MIGRATION_FAILURE'];
    const f = fixture({ 'raw-pod': lines.join('\n') });
    const entries = await f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 });
    // Date.parse("42") 会成功；这不能成为删掉正文首词或虚构时间的依据。
    expect(entries.map((entry) => entry.message)).toEqual(lines);
    expect(entries.every((entry) => entry.ts === undefined && entry.stream === 'combined')).toBe(true);
    expect(entries.every((entry) => LogEntryDtoSchema.safeParse(entry).success)).toBe(true);
  });

  test('多 Pod 日志按实际时间合并后限制总行数，正文时间和缩进不丢失', async () => {
    const f = fixture({
      later: '2026-09-14T14:00:03Z 2026-01-01 application date\n2026-09-14T14:00:04.000Z   at migration.ts:42\n',
      earlier: '2026-09-14T14:00:01.000Z first\n2026-09-14T14:00:02.000Z second\n',
    });
    const entries = await f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 3 });
    expect(entries.map(({ ts, message }) => ({ ts, message }))).toEqual([
      { ts: '2026-09-14T14:00:02.000Z', message: 'second' },
      { ts: '2026-09-14T14:00:03.000Z', message: '2026-01-01 application date' },
      { ts: '2026-09-14T14:00:04.000Z', message: '  at migration.ts:42' },
    ]);
  });

  test('日志读取失败保留错误，不能伪装成没有日志或完整的部分结果', async () => {
    const f = fixture({ readable: '2026-09-14T14:00:00Z ready\n', unavailable: 503 });
    await expect(f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  test('混合已知与未知时间时保留每条正文，未知条目不参与时间推断', async () => {
    const f = fixture({ first: 'no timestamp\n2026-09-14T14:00:02Z later\n', second: '2026-09-14T14:00:01Z earlier\nstill unknown\n' });
    const entries = await f.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 });
    expect(entries.map((entry) => entry.message)).toEqual(['earlier', 'later', 'no timestamp', 'still unknown']);
    expect(entries.slice(2).every((entry) => entry.ts === undefined)).toBe(true);
  });

  test('没有匹配 Pod 或日志为空时才返回空记录', async () => {
    const empty = fixture({});
    expect(await empty.observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 })).toEqual([]);
    expect(empty.requests).toHaveLength(1);
    expect(await fixture({ empty: '' }).observer.tailLogs('cs-qa', 'app=qa', { tailLines: 200 })).toEqual([]);
  });
});
