import type { DockSide } from './dockTree';

export interface DockRect { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number }
/** 拖动开始时量一次的几何：每组的标签栏、画面与各标签的位置。 */
export interface DockGeometry {
  readonly groups: readonly { readonly id: string; readonly bar?: DockRect; readonly body: DockRect; readonly tabs: readonly { readonly id: string; readonly rect: DockRect }[] }[];
}
/** 放到某组标签栏的第几个标签前、分到某组的一边、或并入某组。 */
export type DockDrop =
  | { readonly kind: 'tab'; readonly group: string; readonly index: number }
  | { readonly kind: 'split'; readonly group: string; readonly side: DockSide }
  | { readonly kind: 'center'; readonly group: string };

export interface DropOptions {
  /** 一组至少要这么宽／高；分开后两半都放得下才给左右（上下）分屏区。 */
  readonly minWidth: number;
  readonly minHeight: number;
  /** 靠边多少比例算分屏区，其余是并入区。 */
  readonly edge?: number;
}

const inside = (x: number, y: number, rect: DockRect) => x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;

/**
 * 指针落点 → 放置目标（纯函数，便于脱离排版测试）：在标签栏上按标签中线决定插入位置；
 * 在画面上离哪条边最近且在边缘区里就分到那一边（该方向放不下两半时并入），其余并入这一组；落在别处没有目标。
 */
export function resolveDrop(x: number, y: number, geometry: DockGeometry, options: DropOptions): DockDrop | undefined {
  for (const group of geometry.groups) {
    if (group.bar && inside(x, y, group.bar)) {
      const index = group.tabs.filter((tab) => (tab.rect.left + tab.rect.right) / 2 < x).length;
      return { kind: 'tab', group: group.id, index };
    }
    if (!inside(x, y, group.body)) continue;
    const width = group.body.right - group.body.left, height = group.body.bottom - group.body.top;
    const edge = options.edge ?? 0.25, rx = width > 0 ? (x - group.body.left) / width : 0.5, ry = height > 0 ? (y - group.body.top) / height : 0.5;
    const candidates: { side: DockSide; distance: number; fits: boolean }[] = [
      { side: 'left', distance: rx, fits: width >= options.minWidth * 2 },
      { side: 'right', distance: 1 - rx, fits: width >= options.minWidth * 2 },
      { side: 'top', distance: ry, fits: height >= options.minHeight * 2 },
      { side: 'bottom', distance: 1 - ry, fits: height >= options.minHeight * 2 },
    ];
    const nearest = candidates.filter((candidate) => candidate.fits && candidate.distance < edge).sort((a, b) => a.distance - b.distance)[0];
    return nearest ? { kind: 'split', group: group.id, side: nearest.side } : { kind: 'center', group: group.id };
  }
  return undefined;
}

export function sameDrop(a: DockDrop | undefined, b: DockDrop | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
