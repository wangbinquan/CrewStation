import type { SourceFile, Unit, Violation, Workspace } from '../archModel';

/** 单元图与文件图都必须无环（不含测试文件）。 */
export function cycles(ws: Workspace): Violation[] {
  const out: Violation[] = [];
  const unitEdges = new Map<Unit, Set<Unit>>();
  const fileEdges = new Map<SourceFile, Set<SourceFile>>();
  for (const file of ws.files.filter((f) => !f.isTest)) {
    for (const imp of file.imports) {
      if (imp.targetUnit && imp.targetUnit !== file.unit) addEdge(unitEdges, file.unit, imp.targetUnit);
      if (imp.targetFile && !imp.targetFile.isTest) addEdge(fileEdges, file, imp.targetFile);
    }
  }
  for (const cycle of stronglyConnected(ws.units, unitEdges)) {
    out.push({ rule: 'no-cycles', file: `${cycle[0]?.dir}/package.json`, message: `单元环：${cycle.map((u) => u.relDir).join(' → ')}` });
  }
  for (const cycle of stronglyConnected(ws.files, fileEdges)) {
    out.push({ rule: 'no-cycles', file: cycle[0]?.path ?? '', message: `文件环（${cycle.length} 个文件）：${cycle.slice(0, 5).map((f) => f.rel).join(' → ')}` });
  }
  return out;
}

function addEdge<T>(edges: Map<T, Set<T>>, from: T, to: T): void {
  const set = edges.get(from) ?? new Set<T>();
  set.add(to);
  edges.set(from, set);
}

/** Tarjan：返回大小大于 1 的强连通分量。 */
function stronglyConnected<T>(nodes: T[], edges: Map<T, Set<T>>): T[][] {
  const index = new Map<T, number>();
  const low = new Map<T, number>();
  const onStack = new Set<T>();
  const stack: T[] = [];
  const result: T[][] = [];
  let counter = 0;
  const visit = (node: T): void => {
    index.set(node, counter); low.set(node, counter); counter += 1;
    stack.push(node); onStack.add(node);
    for (const next of edges.get(node) ?? []) {
      if (!index.has(next)) { visit(next); low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0)); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
    }
    if (low.get(node) === index.get(node)) {
      const component: T[] = [];
      let popped: T | undefined;
      do { popped = stack.pop(); if (popped !== undefined) { onStack.delete(popped); component.push(popped); } } while (popped !== undefined && popped !== node);
      if (component.length > 1) result.push(component.reverse());
    }
  };
  for (const node of nodes) if (!index.has(node)) visit(node);
  return result;
}
