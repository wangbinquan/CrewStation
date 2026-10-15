import type { ProjectSummary, ProjectSummaryDetail } from '@crewstation/contracts';
import { summaryIsFresh } from '../projectSummaryState';

export function firstDeliveryPending(item: ProjectSummary): boolean {
  return item.project.kind === 'DigitalWorker' && item.project.state === 'active' && item.role !== 'tester' && summaryIsFresh(item) && item.slots.status === 'ready' && summaryIsFresh(item.slots)
    && !item.slots.value.some(slot => slot.name === 'prod' && slot.releaseId);
}

export function firstDeliveryState(item: ProjectSummaryDetail) {
  const fresh = summaryIsFresh(item), slots = item.slots.status === 'ready' && summaryIsFresh(item.slots) ? item.slots.value : undefined;
  const ready = (name: 'prod' | 'preview') => fresh ? slots?.find(slot => slot.name === name && slot.state === 'ready' && slot.readyReplicas > 0 && slot.releaseId && slot.commitSha) : undefined;
  const production = ready('prod'), preview = ready('preview');
  const latest = item.releases.status === 'ready' && summaryIsFresh(item.releases) ? item.releases.value[0] : undefined;
  const pendingRelease = latest && latest.status !== 'ready' && latest.status !== 'superseded' ? latest : undefined;
  const current = !fresh || item.project.state !== 'active' ? 1 : production ? 4 : preview || pendingRelease ? 3 : 2;
  const stage = !fresh ? 'unknown' : current === 3 && pendingRelease ? 'release' : String(current);
  return { current, stage, production, preview, latest, pendingRelease, fresh, slotsKnown: !!slots };
}
