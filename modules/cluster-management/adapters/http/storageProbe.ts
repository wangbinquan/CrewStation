import { isIP } from 'node:net';
import { boundedMetricsText } from '@crewstation/k8s';
import { MeasurementResponseSchema } from '@crewstation/filesystem-metrics';
import type { StorageTarget, StorageResult } from '../../domain/observations';
import { gauge, missingMetric } from '../../domain/metricValues';
import type { MetricsOptions } from '../../ports/metrics';

export async function measureStorageTargets(targets: StorageTarget[], options: MetricsOptions, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<StorageResult[]> {
  if (!targets.length) return [];
  const first = targets[0]!;
  const unavailable = (reason: string): StorageResult[] => targets.map((t) => ({ uid: t.uid, volumeUid: t.volumeUid, metric: missingMetric('volumeUsed', 'local-path-probe', reason, 'error') }));
  if (!first.address || !isIP(first.address) || targets.some((t) => t.address !== first.address || t.node !== first.node)) return unavailable('Storage probe address is unavailable or inconsistent');
  try {
    const address = isIP(first.address) === 6 ? `[${first.address}]` : first.address;
    const response = await fetcher(`http://${address}:${options.probePort}/measure`, { method: 'POST', headers: { authorization: `Bearer ${options.probeToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ targets: targets.map((t) => ({ key: `${t.uid}/${t.volumeUid}`, rootId: t.rootId, relativePath: t.relativePath })) }), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!response.ok) return unavailable(`Storage probe HTTP ${response.status}`);
    const text = await boundedMetricsText(response, 128_000);
    const parsed = MeasurementResponseSchema.parse(JSON.parse(text));
    return targets.map((target) => {
      const matches = parsed.items.filter((m) => m.key === `${target.uid}/${target.volumeUid}`), item = matches.length === 1 ? matches[0] : undefined;
      return { uid: target.uid, volumeUid: target.volumeUid, metric: item?.state === 'fresh' ? gauge('volumeUsed', item.allocatedBytes, item.observedAt, 'local-path-probe', Date.now()) : missingMetric('volumeUsed', 'local-path-probe', item?.reason ?? 'Probe omitted or duplicated target identity', 'error') };
    });
  } catch (error) { return unavailable(`Storage probe: ${error instanceof Error ? error.name : 'request failed'}`); }
}
