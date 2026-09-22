import type { ReleaseDto, TrafficSwitchDto } from '@crewstation/contracts';

export type ReleaseTimelineEntry =
  | { readonly kind: 'release'; readonly id: string; readonly at: string; readonly release: ReleaseDto }
  | { readonly kind: 'switch'; readonly id: string; readonly at: string; readonly entry: TrafficSwitchDto; readonly tag?: string; readonly actorName?: string; readonly rollback: boolean };

/**
 * 发布与切流合并成一条按时间倒序的记录（RFC-020 D5）。切流条目解析标签与操作人名字：
 * 在发布列表里找不到的发布、成员目录里找不到的人（已离开项目）都保留 ID，由界面显示短 ID。
 * 回退＝目标发布比切走的发布更早；缺任一条发布记录就不下结论。
 */
export function releaseTimeline(releases: readonly ReleaseDto[], switches: readonly TrafficSwitchDto[], names: ReadonlyMap<string, string> = new Map()): ReleaseTimelineEntry[] {
  const byId = new Map(releases.map((release) => [release.id as string, release]));
  const entries: ReleaseTimelineEntry[] = [
    ...releases.map((release) => ({ kind: 'release' as const, id: `release:${release.id}`, at: release.createdAt, release })),
    ...switches.map((entry) => {
      const target = byId.get(entry.releaseId), previous = entry.previousReleaseId ? byId.get(entry.previousReleaseId) : undefined;
      return { kind: 'switch' as const, id: `switch:${entry.id}`, at: entry.createdAt, entry, tag: target?.tag, actorName: names.get(entry.actorUserId),
        rollback: !!target && !!previous && Date.parse(target.createdAt) < Date.parse(previous.createdAt) };
    }),
  ];
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === 'switch' ? -1 : 1));
}

/** 36 位 ID 只在技术详情里完整出现；列表里显示前 8 位。 */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
