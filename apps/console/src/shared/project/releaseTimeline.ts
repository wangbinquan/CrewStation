import type { MaintenanceEventDto, ReleaseDto, SlotEventDto, TrafficSwitchDto } from '@crewstation/contracts';

export type ReleaseTimelineEntry =
  | { readonly kind: 'release'; readonly id: string; readonly at: string; readonly release: ReleaseDto }
  | { readonly kind: 'switch'; readonly id: string; readonly at: string; readonly entry: TrafficSwitchDto; readonly tag?: string; readonly actorName?: string; readonly rollback: boolean }
  | { readonly kind: 'slot'; readonly id: string; readonly at: string; readonly event: SlotEventDto; readonly actorName?: string }
  | { readonly kind: 'maintenance'; readonly id: string; readonly at: string; readonly event: MaintenanceEventDto; readonly actorName?: string };

/** 待命槽的下线／重新部署／推迟／提醒，与正式版本维护的进入／调整／退出（RFC-021）。 */
export interface LifecycleRecords {
  readonly slotEvents?: readonly SlotEventDto[];
  readonly maintenance?: readonly MaintenanceEventDto[];
}

/** 同一时刻的先后：切流与各类操作总是发生在它所涉及的发布之后，排在发布前。 */
const RANK: Readonly<Record<ReleaseTimelineEntry['kind'], number>> = { switch: 0, slot: 1, maintenance: 2, release: 3 };

/**
 * 发布、切流与待命槽、维护记录合并成一条按时间倒序的记录（RFC-020 D5、RFC-021 B8）。切流条目解析标签与操作人名字：
 * 在发布列表里找不到的发布、成员目录里找不到的人（已离开项目）都保留 ID，由界面显示短 ID。
 * 回退＝目标发布比切走的发布更早；缺任一条发布记录就不下结论。
 */
export function releaseTimeline(releases: readonly ReleaseDto[], switches: readonly TrafficSwitchDto[], names: ReadonlyMap<string, string> = new Map(), records: LifecycleRecords = {}): ReleaseTimelineEntry[] {
  const byId = new Map(releases.map((release) => [release.id as string, release]));
  const nameOf = (userId: string | undefined) => (userId === undefined ? undefined : names.get(userId));
  const entries: ReleaseTimelineEntry[] = [
    ...releases.map((release) => ({ kind: 'release' as const, id: `release:${release.id}`, at: release.createdAt, release })),
    ...switches.map((entry) => {
      const target = byId.get(entry.releaseId), previous = entry.previousReleaseId ? byId.get(entry.previousReleaseId) : undefined;
      return { kind: 'switch' as const, id: `switch:${entry.id}`, at: entry.createdAt, entry, tag: target?.tag, actorName: names.get(entry.actorUserId),
        rollback: !!target && !!previous && Date.parse(target.createdAt) < Date.parse(previous.createdAt) };
    }),
    ...(records.slotEvents ?? []).map((event) => ({ kind: 'slot' as const, id: `slot:${event.id}`, at: event.at, event, actorName: nameOf(event.actorUserId) })),
    ...(records.maintenance ?? []).map((event) => ({ kind: 'maintenance' as const, id: `maintenance:${event.id}`, at: event.at, event, actorName: nameOf(event.actorUserId) })),
  ];
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || RANK[a.kind] - RANK[b.kind]);
}

export type ReleaseOrSwitchEntry = Extract<ReleaseTimelineEntry, { readonly kind: 'release' | 'switch' }>;
/** 概览的最近动态只列发布与切流；完整记录（含下线与维护）在发布页。 */
export function isReleaseOrSwitch(entry: ReleaseTimelineEntry): entry is ReleaseOrSwitchEntry {
  return entry.kind === 'release' || entry.kind === 'switch';
}

/** 36 位 ID 只在技术详情里完整出现；列表里显示前 8 位。 */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
