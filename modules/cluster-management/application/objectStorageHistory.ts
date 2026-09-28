import type { ObjectStorageSample, StorageWindow } from '@crewstation/contracts';
import { ResourceIdSchema } from '@crewstation/contracts';
import type { HistoryReader } from '../ports/metrics';

const windows: Record<StorageWindow, number> = { '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800 };
const missing = (reason: string) => ({ samples: [] as ObjectStorageSample[], observedAt: null, stale: true, unavailableReason: reason });

/** Reuses the platform's authenticated, bounded Prometheus client. Callers authorize the scope. */
export function objectStorageHistory(reader: HistoryReader, enabled: boolean, now: () => Date = () => new Date()) {
  return async (input: { backendId: string; spaceId?: string; window: StorageWindow }) => {
    if (!enabled) return missing('平台历史指标未配置');
    ResourceIdSchema.parse(input.backendId); if (input.spaceId) ResourceIdSchema.parse(input.spaceId);
    const labels = `backend_id="${input.backendId}"${input.spaceId ? `,space_id="${input.spaceId}"` : ''}`;
    const seconds = windows[input.window], end = Math.floor(now().getTime() / 1000), step = Math.max(15, Math.ceil(seconds / 960 / 15) * 15), start = end - seconds;
    const total = `sum(rate(cs_object_transfer_requests_total{${labels},operation=~"put|get"}[2m]))`;
    const queries = {
      writeBytesPerSecond: `sum(rate(cs_object_transfer_bytes_total{${labels},operation="put"}[2m]))`,
      readBytesPerSecond: `sum(rate(cs_object_transfer_bytes_total{${labels},operation="get"}[2m]))`,
      requestsPerSecond: total,
      errorRatio: `(sum(rate(cs_object_transfer_requests_total{${labels},operation=~"put|get",result=~"error|aborted"}[2m])) or on() 0 * ${total}) / clamp_min(${total}, 0.000000001)`,
      p95Seconds: `histogram_quantile(0.95, sum by(le)(rate(cs_object_transfer_seconds_bucket{${labels},operation=~"put|get"}[2m]))) >= 0`,
      observedAt: `max(timestamp(cs_object_transfer_requests_total{${labels}}))`,
      dropped: 'sum(cs_object_transfer_measurements_dropped_total)',
    };
    try {
      const results = await Promise.all(Object.entries(queries).map(async ([name, query]) => ({ name, series: await reader.range(query, start, end, step, AbortSignal.timeout(10_000)) })));
      const points = new Map<number, ObjectStorageSample>(); let latest: number | null = null, incomplete = false;
      for (let at = start; at <= end; at += step) points.set(at, { at: new Date(at * 1000).toISOString(), readBytesPerSecond: null, writeBytesPerSecond: null, requestsPerSecond: null, errorRatio: null, p95Seconds: null });
      for (const result of results) {
        for (const series of result.series) for (const [at, raw] of series.values) {
          const value = Number(raw); if (!Number.isFinite(value) || value < 0) continue;
          if (result.name === 'dropped') { incomplete ||= value > 0; continue; }
          if (result.name === 'observedAt') { latest = Math.max(latest ?? 0, value); continue; }
          const point = points.get(at) ?? { at: new Date(at * 1000).toISOString(), readBytesPerSecond: null, writeBytesPerSecond: null, requestsPerSecond: null, errorRatio: null, p95Seconds: null };
          if (result.name === 'errorRatio') point.errorRatio = Math.min(1, value);
          else point[result.name as 'readBytesPerSecond' | 'writeBytesPerSecond' | 'requestsPerSecond' | 'p95Seconds'] = value;
          points.set(at, point);
        }
      }
      const stale = latest === null || end - latest > 120 || incomplete;
      return { samples: latest === null ? [] : [...points.entries()].sort(([a], [b]) => a - b).map(([, point]) => point), observedAt: latest === null ? null : new Date(latest * 1000).toISOString(), stale, unavailableReason: latest === null ? '尚无对象传输采集样本' : incomplete ? '对象传输采集容量不足，指标不完整' : stale ? '对象传输采集已过期' : null };
    } catch { return missing('无法读取对象传输历史指标'); }
  };
}
