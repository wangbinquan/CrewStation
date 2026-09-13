export function splitWeights(values: readonly number[], length: number): number[] {
  const weights = Array.from({ length }, (_, i) => values[i] ?? 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((value) => value / sum);
}
/** 相邻两块的总占比不变；其余窗口不跳动。 */
export function adjustSplit(values: readonly number[], index: number, delta: number, minimum: number): number[] {
  const next = [...values], total = (next[index] ?? 0) + (next[index + 1] ?? 0);
  const min = Math.min(minimum, total / 2);
  next[index] = Math.max(min, Math.min(total - min, (next[index] ?? 0) + delta));
  next[index + 1] = total - next[index]!;
  return next;
}
