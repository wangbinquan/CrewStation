import type { HistoryReader, PrometheusMatrix } from '../../ports/metrics';
import { boundedMetricsText } from '@crewstation/k8s';
import { objectArray, objectRecord, stringRecord } from '../../domain/inventory';

export function prometheusHistoryReader(url: string, token: string, fetcher: typeof fetch = fetch): HistoryReader {
  return { range: async (query, start, end, step, signal) => {
    if (!url) throw new Error('History storage has not been configured');
    const target = new URL('/api/v1/query_range', url); target.search = new URLSearchParams({ query, start: String(start), end: String(end), step: String(step), timeout: '8s' }).toString();
    const response = await fetcher(target, { headers: { authorization: `Basic ${Buffer.from(`crewstation:${token}`).toString('base64')}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    if (!response.ok) throw new Error(`History storage HTTP ${response.status}`);
    const body = objectRecord(JSON.parse(await boundedMetricsText(response, 4 * 1024 * 1024))), data = objectRecord(body.data);
    if (body.status !== 'success' || data.resultType !== 'matrix' || !Array.isArray(data.result) || data.result.length > 8) throw new Error('Invalid or excessive history series');
    return objectArray(data.result).map((r): PrometheusMatrix => {
      if (!Array.isArray(r.values) || r.values.length > 1440) throw new Error('History point limit exceeded');
      const values = r.values.map((p): [number, string] => {
        if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'number' || typeof p[1] !== 'string' || !Number.isFinite(Number(p[1])) || p[0] < start || p[0] > end) throw new Error('Invalid history point');
        return [p[0], p[1]];
      });
      return { metric: stringRecord(r.metric), values };
    });
  } };
}
