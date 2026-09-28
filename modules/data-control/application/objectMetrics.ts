import type { ObjectTransferMeasurement, ObjectTransferMeter } from '../ports/objectPlane';

const buckets = [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 120, 600, 1800];
interface Measurement { labels: string; bytes: number; requests: number; seconds: number; buckets: number[] }
/** Prometheus scrapes each process; only bounded backend/space/operation/result labels are accepted. */
export function objectTransferMetrics(maxSeries = 4096): ObjectTransferMeter & { render(): string } {
  const series = new Map<string, Measurement>();
  let dropped = 0;
  return {
    record: (input) => {
      if (!valid(input)) { dropped++; return; }
      const labels = `backend_id="${input.backendId}",space_id="${input.spaceId}",operation="${input.operation}",result="${input.result}"`;
      let current = series.get(labels);
      if (!current) {
        if (series.size >= maxSeries) { dropped++; return; }
        current = { labels, bytes: 0, requests: 0, seconds: 0, buckets: buckets.map(() => 0) }; series.set(labels, current);
      }
      current.bytes += input.bytes; current.requests++; current.seconds += input.durationSeconds;
      buckets.forEach((bound, i) => { if (input.durationSeconds <= bound) current!.buckets[i] = current!.buckets[i]! + 1; });
    },
    render: () => {
      const lines = ['# TYPE cs_object_transfer_bytes_total counter', '# TYPE cs_object_transfer_requests_total counter', '# TYPE cs_object_transfer_seconds histogram', '# TYPE cs_object_transfer_measurements_dropped_total counter', `cs_object_transfer_measurements_dropped_total ${dropped}`];
      for (const value of series.values()) {
        lines.push(`cs_object_transfer_bytes_total{${value.labels}} ${value.bytes}`, `cs_object_transfer_requests_total{${value.labels}} ${value.requests}`);
        buckets.forEach((bound, i) => lines.push(`cs_object_transfer_seconds_bucket{${value.labels},le="${bound}"} ${value.buckets[i]}`));
        lines.push(`cs_object_transfer_seconds_bucket{${value.labels},le="+Inf"} ${value.requests}`, `cs_object_transfer_seconds_count{${value.labels}} ${value.requests}`, `cs_object_transfer_seconds_sum{${value.labels}} ${value.seconds}`);
      }
      return `${lines.join('\n')}\n`;
    },
  };
}
function valid(input: ObjectTransferMeasurement): boolean {
  const identifier = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  return identifier.test(input.backendId) && (input.spaceId === 'system' || identifier.test(input.spaceId)) && ['put', 'get', 'verify', 'delete', 'head'].includes(input.operation) && ['ok', 'error', 'aborted'].includes(input.result)
    && Number.isSafeInteger(input.bytes) && input.bytes >= 0 && Number.isFinite(input.durationSeconds) && input.durationSeconds >= 0;
}
