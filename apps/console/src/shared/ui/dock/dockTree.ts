/**
 * 分屏树（无业务含义）：叶子是一组的 ID，分支把子项左右（row）或上下（column）排开，`sizes` 是各子项的相对大小。
 * 与布局契约 `WorkspaceDockNode` 同形。所有函数都不改入参，返回新树。
 */
export type DockNode = DockLeaf | DockSplit;
export interface DockLeaf { group: string }
export interface DockSplit { direction: DockDirection; children: DockNode[]; sizes: number[] }
export type DockDirection = 'row' | 'column';
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
/** 从根到某个分支经过的子项下标；空序列是根。 */
export type DockPath = readonly number[];

/** 与契约的上限一致：超过就保存不了，所以在改树时先拦下。 */
export const DOCK_LIMITS = { depth: 8, nodes: 64, children: 16 } as const;

export function isLeaf(node: DockNode): node is DockLeaf {
  return 'group' in node;
}

export function dockGroups(node: DockNode | undefined): string[] {
  if (!node) return [];
  return isLeaf(node) ? [node.group] : node.children.flatMap(dockGroups);
}

export function sideDirection(side: DockSide): DockDirection {
  return side === 'left' || side === 'right' ? 'row' : 'column';
}

/**
 * 把 `group` 放到 `target` 的一边：父分支同方向时插在旁边、两块平分 target 原来的大小；否则把 target 换成一个新的二分支。
 * 找不到 target 或超出上限时返回 undefined。
 */
export function splitGroup(root: DockNode, target: string, side: DockSide, group: string): DockNode | undefined {
  const next = insertBeside(root, target, sideDirection(side), side === 'left' || side === 'top', group);
  return next && withinLimits(next) ? tidy(next) : undefined;
}

function insertBeside(node: DockNode, target: string, direction: DockDirection, before: boolean, group: string): DockNode | undefined {
  if (isLeaf(node)) {
    if (node.group !== target) return undefined;
    return { direction, children: before ? [{ group }, node] : [node, { group }], sizes: [1, 1] };
  }
  const index = node.children.findIndex((child) => isLeaf(child) && child.group === target);
  if (index >= 0 && node.direction === direction) {
    const half = (node.sizes[index] ?? 1) / 2, at = before ? index : index + 1;
    const children = [...node.children], sizes = [...node.sizes];
    children.splice(at, 0, { group }); sizes[index] = half; sizes.splice(at, 0, half);
    return { ...node, children, sizes };
  }
  for (let i = 0; i < node.children.length; i++) {
    const replaced = insertBeside(node.children[i]!, target, direction, before, group);
    if (replaced) return { ...node, children: node.children.map((child, j) => j === i ? replaced : child) };
  }
  return undefined;
}

/** 去掉一组：相邻的兄弟（优先前一个）接过它的大小；分支只剩一个子项时由它取代分支。整棵树只剩这一组时返回 undefined。 */
export function removeGroup(root: DockNode, group: string): DockNode | undefined {
  const next = without(root, group);
  return next && tidy(next);
}

function without(node: DockNode, group: string): DockNode | undefined {
  if (isLeaf(node)) return node.group === group ? undefined : node;
  const children: DockNode[] = [], sizes: number[] = [];
  let carry = 0;
  node.children.forEach((child, i) => {
    const kept = without(child, group), size = node.sizes[i] ?? 1;
    if (!kept) {
      if (sizes.length) sizes[sizes.length - 1] = (sizes[sizes.length - 1] ?? 0) + size; else carry += size;
      return;
    }
    children.push(kept); sizes.push(size + carry); carry = 0;
  });
  if (children.length <= 1) return children[0];
  return { ...node, children, sizes };
}

/** 与给定的组对齐：去掉不在其中的叶子（重复出现的连同本身一起去掉、再补回），缺的组依次补在最右边。用来修正与页签对不上的树。 */
export function alignGroups(root: DockNode | undefined, groups: readonly string[]): DockNode | undefined {
  let next = root;
  const seen = new Set<string>();
  for (const group of dockGroups(root)) {
    if (!groups.includes(group) || seen.has(group)) next = next && without(next, group);
    seen.add(group);
  }
  const present = new Set(dockGroups(next));
  for (const group of groups) if (!present.has(group)) next = next ? appendRight(next, group) : { group };
  return next && tidy(next);
}

function appendRight(root: DockNode, group: string): DockNode {
  if (!isLeaf(root) && root.direction === 'row') return { ...root, children: [...root.children, { group }], sizes: [...root.sizes, 1] };
  return { direction: 'row', children: [root, { group }], sizes: [dockGroups(root).length, 1] };
}

/**
 * 规整：单子项分支由子项取代，同方向的嵌套分支压平（按父槽位缩放大小），大小换算成平均为 1、保留四位小数。
 * 结果只取决于树的形状与比例，重复调用不再变化。
 */
export function tidy(node: DockNode): DockNode {
  if (isLeaf(node)) return node;
  const children: DockNode[] = [], sizes: number[] = [];
  node.children.forEach((raw, i) => {
    const child = tidy(raw), size = node.sizes[i] ?? 1;
    if (isLeaf(child) || child.direction !== node.direction) { children.push(child); sizes.push(size); return; }
    const total = child.sizes.reduce((sum, value) => sum + value, 0) || 1;
    child.children.forEach((grand, j) => { children.push(grand); sizes.push(size * (child.sizes[j] ?? 1) / total); });
  });
  if (children.length === 1) return children[0]!;
  return { direction: node.direction, children, sizes: normalizeSizes(sizes) };
}

function normalizeSizes(sizes: readonly number[]): number[] {
  const total = sizes.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!(total > 0)) return sizes.map(() => 1);
  return sizes.map((value) => Math.min(100, Math.max(0.01, Math.round(Math.max(0, value) / total * sizes.length * 1e4) / 1e4)));
}

export function withinLimits(node: DockNode): boolean {
  const measure = (current: DockNode, depth: number): { depth: number; nodes: number; widest: number } => {
    if (isLeaf(current)) return { depth, nodes: 1, widest: 0 };
    const parts = current.children.map((child) => measure(child, depth + 1));
    return { depth: Math.max(...parts.map((part) => part.depth)), nodes: 1 + parts.reduce((sum, part) => sum + part.nodes, 0), widest: Math.max(current.children.length, ...parts.map((part) => part.widest)) };
  };
  const shape = measure(node, 1);
  return shape.depth <= DOCK_LIMITS.depth && shape.nodes <= DOCK_LIMITS.nodes && shape.widest <= DOCK_LIMITS.children;
}

export function nodeAt(root: DockNode, path: DockPath): DockNode | undefined {
  let node: DockNode | undefined = root;
  for (const index of path) node = node && !isLeaf(node) ? node.children[index] : undefined;
  return node;
}

/** 改某个分支的大小；路径不是分支或数量不符时原样返回。 */
export function setSizes(root: DockNode, path: DockPath, sizes: readonly number[]): DockNode {
  const target = nodeAt(root, path);
  if (!target || isLeaf(target) || target.children.length !== sizes.length) return root;
  const replace = (node: DockNode, depth: number): DockNode => {
    if (isLeaf(node)) return node;
    if (depth === path.length) return { ...node, sizes: normalizeSizes(sizes) };
    return { ...node, children: node.children.map((child, i) => i === path[depth] ? replace(child, depth + 1) : child) };
  };
  return replace(root, 0);
}

export function equalizeSizes(root: DockNode, path: DockPath): DockNode {
  const target = nodeAt(root, path);
  return target && !isLeaf(target) ? setSizes(root, path, target.children.map(() => 1)) : root;
}

/** 整棵树不再压缩时需要的最小尺寸：左右排开的宽度相加、上下排开的取最大，分隔条计入。 */
export function minimumSize(node: DockNode, leaf: { width: number; height: number }, gutter: number): { width: number; height: number } {
  if (isLeaf(node)) return leaf;
  const parts = node.children.map((child) => minimumSize(child, leaf, gutter)), gaps = gutter * (parts.length - 1);
  return node.direction === 'row'
    ? { width: parts.reduce((sum, part) => sum + part.width, 0) + gaps, height: Math.max(...parts.map((part) => part.height)) }
    : { width: Math.max(...parts.map((part) => part.width)), height: parts.reduce((sum, part) => sum + part.height, 0) + gaps };
}
