// RFC-034 v2 §5 —— 统计查询共用的纯函数（与 agent-workflow RFC-371 v2 `domain/statistics.ts` 同义）。

const DAY_MS = 86_400_000;

/** 升序样本的最近秩百分位；空样本为 null。 */
export function nearestRank(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(fraction * sorted.length)));
  return sorted[rank - 1]!;
}

/** 固定 UTC 偏移（东正西负，分钟）下某一时刻的日序号。 */
export function dayIndex(epochMs: number, offsetMinutes: number): number {
  return Math.floor((epochMs + offsetMinutes * 60_000) / DAY_MS);
}

/** 日序号的 `YYYY-MM-DD`。 */
export function dayLabel(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

/** [from, to) 覆盖的每一个日序号，图表坐标轴不留空洞。 */
export function dayIndexes(from: number, to: number, offsetMinutes: number): number[] {
  const days: number[] = [];
  for (let day = dayIndex(from, offsetMinutes), last = dayIndex(to - 1, offsetMinutes); day <= last; day++) days.push(day);
  return days;
}

/** 键集分页游标：不透明的 base64url，非法输入抛 RangeError。 */
export function encodeCursor(parts: readonly (string | number)[]): string {
  return Buffer.from(JSON.stringify(parts)).toString('base64url');
}

export function decodeCursor<T extends readonly unknown[]>(cursor: string | undefined, shape: (value: unknown[]) => value is unknown[] & T): T | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(value) && shape(value)) return value;
  } catch {
    /* 落到下面统一报错 */
  }
  throw new RangeError('invalid-cursor');
}
