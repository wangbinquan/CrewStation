import type { ClusterResource, ResourceRecord } from '@crewstation/contracts';
import type { Translate } from '../lib/useT';
import type { TopologyParts } from './storageTopology';
import { recordStatus } from './recordBands';

export function appendObjectSpaces(parts: TopologyParts, records: readonly ResourceRecord[], resources: readonly ClusterResource[], t: Translate): void {
  const spaces = records.filter((r) => r.kind === 'object-space');
  if (!spaces.length) return;
  const band = 'object-storage';
  parts.bands.push({ id: band, title: t('objects.spaces'), semantic: 'data' });
  for (const space of spaces) {
    const display = space.display ?? {}, observed = recordStatus(space, t);
    parts.nodes.push({ id: space.id, kind: 'object-space', semantic: 'data', title: t(`objects.${display.env ?? 'unknown'}`),
      subtitle: display.backend, lane: 3, band, ...observed, abnormal: space.phase === 'degraded',
      facts: [[t('objects.spaceId'), space.id], [t('objects.backend'), display.backend ?? '—'], [t('objects.used'), `${display.usedBytes ?? '—'} B`],
        [t('objects.reserved'), `${display.reservedBytes ?? '—'} B`], [t('objects.capacity'), `${display.quotaBytes ?? '—'} B`], [t('objects.updated'), display.observedAt || '—']],
    });
    if (display.env !== 'production') continue;
    for (const slot of records.filter((r) => r.kind === 'service-slot' && r.display?.serviceId === display.serviceId && r.display?.objectStorage === 'true')) {
      for (const child of slot.children.filter((c) => c.kind === 'Deployment' && c.phase !== 'absent' && c.uid)) {
        const deployed = resources.find((r) => r.uid === child.uid && r.releaseId === slot.display?.releaseId);
        const node = deployed && parts.nodes.find((n) => n.resourceId === deployed.resourceId);
        if (node) parts.edges.push({ from: node.id, to: space.id, kind: 'uses', label: 'CS_OBJECT_SPACE_ID', evidence: 'observed' });
      }
    }
  }
}
