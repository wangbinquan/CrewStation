import type { MaintenanceEventKind, SlotEventDto, SlotEventKind } from '@crewstation/contracts';
import type { Translate } from '../../../shared/lib/useT';
import type { ReleaseTimelineEntry } from '../../../shared/project/releaseTimeline';
import { shortId } from '../../../shared/project/releaseTimeline';
import type { BadgeTone } from '../../../shared/ui/Badge';
import type { TimelineItem } from '../../../shared/ui/Timeline';
import { blockingText } from '../model/maintenanceDraft';

type LifecycleEntry = Extract<ReleaseTimelineEntry, { readonly kind: 'slot' | 'maintenance' }>;

const SLOT_TONE: Readonly<Record<SlotEventKind, BadgeTone>> = { offline: 'neutral', redeploy: 'info', postpone: 'neutral', reminder: 'warning' };
const MAINTENANCE_TONE: Readonly<Record<MaintenanceEventKind, BadgeTone>> = { entered: 'warning', updated: 'warning', exited: 'success' };

function slotPrimary(event: SlotEventDto, actor: string, t: Translate, date: (value: string | undefined) => string): string {
  if (event.kind === 'offline') return event.actorUserId ? t('release.timeline.offlineBy', { actor, tag: event.tag }) : t('release.timeline.offlineAuto', { tag: event.tag });
  if (event.kind === 'redeploy') return t('release.timeline.redeploy', { actor, tag: event.tag });
  if (event.kind === 'postpone') return t('release.timeline.postpone', { actor, tag: event.tag, time: date(event.deadline) });
  return t('release.timeline.reminder', { tag: event.tag, time: date(event.deadline) });
}

/**
 * 待命槽与维护记录在发布时间线上的一行（RFC-021 B8）：一整句话、人名代替 ID（名单里没有的退回短 ID），
 * 平台自动做的（到期下线、提醒）不写操作人。形状用方块：它们是对部署的操作，不是一次发布。
 */
export function lifecycleTimelineItem(entry: LifecycleEntry, t: Translate, date: (value: string | undefined) => string): TimelineItem {
  const actor = entry.actorName ?? (entry.event.actorUserId ? t('timeline.unknownActor', { id: shortId(entry.event.actorUserId) }) : '');
  if (entry.kind === 'slot') {
    const event = entry.event;
    return { id: entry.id, tone: SLOT_TONE[event.kind], shape: 'square', time: date(entry.at), primary: slotPrimary(event, actor, t, date),
      ...(event.kind === 'offline' && event.reason ? { secondary: t(`slot.offline.reason.${event.reason}`) } : {}) };
  }
  const event = entry.event;
  return { id: entry.id, tone: MAINTENANCE_TONE[event.kind], shape: 'square', time: date(entry.at), primary: t(`release.timeline.maintenance.${event.kind}`, { actor }),
    ...(event.kind === 'exited' ? {} : { secondary: t('release.timeline.maintenanceDetail', { reason: event.reason, blocking: blockingText(event.switches, t) }) }) };
}
