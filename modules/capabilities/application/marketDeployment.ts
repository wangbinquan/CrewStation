import type { MarketAppDto, SlotDto } from '@crewstation/contracts';
import type { Clock } from '@crewstation/kernel';
import type { MarketListingSource, MarketSources } from '../ports/market';

export async function marketSlots(sources: MarketSources, listing: MarketListingSource): Promise<SlotDto[] | undefined> {
  if (!listing.serviceId) return listing.projectState === 'provisioning' ? [] : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([sources.slots(listing.serviceId), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('source timeout')), 2500); })]);
  } catch { return undefined; }
  finally { clearTimeout(timer); }
}

export function productionOf(slots: SlotDto[] | undefined, clock: Clock): MarketAppDto['production'] {
  const checkedAt = clock.now().toISOString();
  const unknown = { status: 'unknown', freshness: 'unknown', checkedAt } as const;
  if (!slots) return unknown;
  if (slots.length === 0) return { status: 'not-deployed', freshness: 'current', checkedAt };
  const active = slots.filter((slot) => slot.name === 'prod' && slot.active);
  if (active.length !== 1) return unknown;
  const slot = active[0]!;
  if (slot.state === 'empty' && !slot.releaseId) return { status: 'not-deployed', freshness: 'current', checkedAt };
  if (slot.state === 'empty' || !slot.releaseId || !slot.tag || !slot.commitSha || !slot.host) return unknown;
  return { status: 'deployed', tag: slot.tag, commitSha: slot.commitSha, host: slot.host, state: slot.state, freshness: 'current', checkedAt };
}

export function trialOf(slots: SlotDto[] | undefined, listing: MarketListingSource) {
  if (!slots) return { status: 'unknown' as const };
  const preview = slots.filter((s) => s.name === 'preview' && !s.active);
  const slot = preview.length === 1 ? preview[0] : undefined;
  const ready = listing.projectState === 'active' && slot?.state === 'ready' && slot.releaseId && slot.tag && slot.host;
  return ready ? { status: 'ready' as const, host: slot.host, version: slot.tag } : { status: 'unavailable' as const };
}

export function entryOf(production: MarketAppDto['production'], listing: MarketListingSource, slots: SlotDto[] | undefined): MarketAppDto['entry'] {
  if (production.status === 'not-deployed' && listing.canPreview) return { kind: 'trial', ...trialOf(slots, listing) };
  if (production.status === 'unknown') return { kind: 'production', status: 'unknown' };
  return production.status === 'deployed' && production.state === 'ready' && listing.projectState === 'active'
    ? { kind: 'production', status: 'ready', host: production.host }
    : { kind: 'production', status: 'unavailable' };
}
