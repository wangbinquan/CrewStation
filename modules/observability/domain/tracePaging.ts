import type { TraceKey } from './traceParts';

/** 一条链在列表里的位置：开始时间（毫秒精度 ISO）＋ traceId；traceId 唯一，所以位置也唯一。 */
export interface TracePosition { readonly at: string; readonly traceId: string }

export const encodeTraceCursor = (position: TracePosition): string => `${position.at}~${position.traceId}`;

/** 游标的格式已由契约校验（`TRACE_CURSOR_PATTERN`）。 */
export function decodeTraceCursor(cursor: string): TracePosition {
  const [at = '', traceId = ''] = cursor.split('~');
  return { at, traceId };
}

/** 列表顺序：开始时间新的在前，同一毫秒按 traceId 倒序。返回负数表示 a 排在 b 前面。 */
export function compareTracePositions(a: TracePosition, b: TracePosition): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return a.traceId === b.traceId ? 0 : a.traceId < b.traceId ? 1 : -1;
}

/**
 * 多个来源各自按「本来源里的开始时间」倒序给出一页时间键，合并后按整条链最早的开始时间排序。
 * 某个来源给满了 limit 条，它最后一条之后的键这一轮没看到；一条链的最早开始时间又可能落在另一个来源里。
 * 只有不晚于所有给满来源最后一条的位置（取其中最靠前的那个）才保证这一轮已完整看到——返回这个下界；
 * 所有来源都没给满时返回 undefined，表示已经看到底。
 */
export function scannedFloor(batches: readonly (readonly TraceKey[])[], limit: number): TracePosition | undefined {
  let floor: TracePosition | undefined;
  for (const batch of batches) {
    const last = batch.at(-1);
    if (batch.length < limit || !last) continue;
    const position = { at: last.firstAt, traceId: last.traceId };
    if (!floor || compareTracePositions(position, floor) < 0) floor = position;
  }
  return floor;
}

/** 位置落在 (cursor, floor] 之间：比游标更早（游标本身是上一页最后一条），且不早于这一轮的下界。 */
export function withinScannedRange(position: TracePosition, cursor: TracePosition | undefined, floor: TracePosition | undefined): boolean {
  return (!cursor || compareTracePositions(position, cursor) > 0) && (!floor || compareTracePositions(position, floor) <= 0);
}

const WINDOW_MS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 } as const;

/** 时间范围按「有活动」算的起点；「全部」没有起点。 */
export function windowStart(window: '1h' | '24h' | '7d' | 'all', now: Date): string | undefined {
  return window === 'all' ? undefined : new Date(now.getTime() - WINDOW_MS[window]).toISOString();
}
