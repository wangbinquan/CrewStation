import type { CSSProperties } from 'react';
import type { DockDirection, DockNode, DockPath } from './dockTree';
import { isLeaf } from './dockTree';

/** 一段长度＝容器尺寸 × pct ＋ px；分隔条是固定像素，其余按比例，所以位置都能写成 calc(百分比 ＋ 像素)。 */
export interface DockLength { readonly pct: number; readonly px: number }
export interface DockBox { readonly left: DockLength; readonly top: DockLength; readonly width: DockLength; readonly height: DockLength }
export interface DockDivider {
  readonly key: string; readonly path: DockPath; readonly index: number; readonly direction: DockDirection;
  readonly box: DockBox; readonly span: DockBox; readonly sizes: readonly number[];
}
export interface DockPlacement { readonly groups: readonly { readonly id: string; readonly box: DockBox }[]; readonly dividers: readonly DockDivider[] }

export const FULL_BOX: DockBox = { left: { pct: 0, px: 0 }, top: { pct: 0, px: 0 }, width: { pct: 1, px: 0 }, height: { pct: 1, px: 0 } };
const plus = (a: DockLength, b: DockLength): DockLength => ({ pct: a.pct + b.pct, px: a.px + b.px });
const scale = (a: DockLength, factor: number): DockLength => ({ pct: a.pct * factor, px: a.px * factor });

/**
 * 按树算出每组与每条分隔条的位置（相对整个区域）。各组都是同一容器下的绝对定位兄弟：
 * 重新排列只改位置与大小，不改 DOM 父子关系，组里的终端因此不会被卸载重挂。
 */
export function placeDock(root: DockNode, gutter: number): DockPlacement {
  const groups: { id: string; box: DockBox }[] = [], dividers: DockDivider[] = [];
  const place = (node: DockNode, box: DockBox, path: DockPath) => {
    if (isLeaf(node)) { groups.push({ id: node.group, box }); return; }
    const row = node.direction === 'row', total = node.sizes.reduce((sum, value) => sum + value, 0) || 1;
    const length = row ? box.width : box.height, available = plus(length, { pct: 0, px: -gutter * (node.children.length - 1) });
    let offset = row ? box.left : box.top;
    node.children.forEach((child, index) => {
      const size = scale(available, (node.sizes[index] ?? 1) / total);
      place(child, row ? { ...box, left: offset, width: size } : { ...box, top: offset, height: size }, [...path, index]);
      offset = plus(offset, size);
      if (index === node.children.length - 1) return;
      const bar = { pct: 0, px: gutter };
      dividers.push({ key: `${path.join('.')}:${index}`, path, index, direction: node.direction, sizes: node.sizes, span: box, box: row ? { ...box, left: offset, width: bar } : { ...box, top: offset, height: bar } });
      offset = plus(offset, bar);
    });
  };
  place(root, FULL_BOX, []);
  return { groups, dividers };
}

const css = (length: DockLength) => {
  const pct = Math.round(length.pct * 1e6) / 1e4, px = Math.round(length.px * 100) / 100;
  return px === 0 ? `${pct}%` : `calc(${pct}% ${px < 0 ? '-' : '+'} ${Math.abs(px)}px)`;
};
export function boxStyle(box: DockBox): CSSProperties {
  return { left: css(box.left), top: css(box.top), width: css(box.width), height: css(box.height) };
}
/** 换算成像素：拖分隔条时按容器实际尺寸把指针位移折成比例。 */
export function boxPixels(box: DockBox, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const px = (length: DockLength, size: number) => length.pct * size + length.px;
  return { left: px(box.left, width), top: px(box.top, height), width: px(box.width, width), height: px(box.height, height) };
}
