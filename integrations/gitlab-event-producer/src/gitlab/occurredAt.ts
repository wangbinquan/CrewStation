/**
 * 事件发生时刻：ProducedEvent 的 `occurredAt` 必须是 RFC 3339 字符串（packages/contracts/events/delivery.ts）。
 * GitLab 各类 payload 的时间字段位置与写法都不同（`2026-09-11 08:00:00 UTC` 与 `2026-09-11T08:00:00Z` 都出现过），
 * 统一交给 Date 解析再转 ISO；解析不出来就退回接收时刻——宁可时刻略有偏差，也不要投递一条平台校验不过的事件。
 */

/** 候选字段按“离事件本身最近”排序，先命中先用。 */
const ATTRIBUTE_FIELDS = ['finished_at', 'updated_at', 'created_at'] as const;

export function deriveOccurredAt(payload: unknown, now: Date): string {
  for (const candidate of candidates(payload)) {
    const parsed = parseTimestamp(candidate);
    if (parsed) return parsed;
  }
  return now.toISOString();
}

function* candidates(payload: unknown): Generator<unknown> {
  const root = asRecord(payload);
  const attributes = asRecord(root?.object_attributes);
  for (const field of ATTRIBUTE_FIELDS) yield attributes?.[field];
  // push／tag push 没有 object_attributes：取最后一个提交的时间戳。
  const commits = Array.isArray(root?.commits) ? root.commits : [];
  yield asRecord(commits[commits.length - 1])?.timestamp;
  yield root?.['updated_at'];
}

/** GitLab 偶尔写作 `2026-09-11 08:00:00 UTC`；Date 认不了带 UTC 后缀的空格格式，先归一化。 */
export function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/ UTC$/, 'Z').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
