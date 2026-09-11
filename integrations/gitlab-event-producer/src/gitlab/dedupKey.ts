/**
 * 去重键：cs-events 的 inbox 以 (producer, dedupKey) 去重（Design §8.5），
 * 所以同一次 GitLab 事件被重投多少次，都必须算出同一个键，而不同事件必须算出不同的键。
 *
 * 取值优先级（第一条命中即用）：
 *   1. `idempotency-key`     GitLab 16.x 起为重投保持不变的幂等键，语义最准；
 *   2. `x-gitlab-event-uuid` 同一次触发的事件 UUID，重投保持不变；
 *   3. payload 指纹           两个头都没有时（老版本 GitLab、手工重放），对可稳定标识该事件的字段取 SHA-256。
 * 三种来源都带前缀且拼上事件类型：同一次投递派生出的不同类型不会互相顶掉，来源不同的键也不会意外相等。
 */
import { createHash } from 'node:crypto';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const EVENT_UUID_HEADER = 'x-gitlab-event-uuid';

/** 平台上限：packages/contracts/events/delivery.ts 的 ProducedEventSchema 限定 dedupKey ≤ 200 字符。 */
export const MAX_DEDUP_KEY_LENGTH = 200;

/** 参与指纹的 payload 字段；按此顺序取值，缺的记成空串，保证同一事件每次算出同一串。 */
const FINGERPRINT_FIELDS = ['object_kind', 'ref', 'before', 'after', 'checkout_sha'] as const;
/** 参与指纹的 `object_attributes` 字段：单个对象（MR／议题／流水线）的身份与最后变更时刻。 */
const ATTRIBUTE_FIELDS = ['id', 'iid', 'action', 'status', 'updated_at', 'finished_at', 'sha'] as const;

export type DedupSource = 'idempotency-key' | 'event-uuid' | 'payload-fingerprint';

export interface DedupKey {
  readonly key: string;
  readonly source: DedupSource;
}

/** headers 用 Headers 而不是普通对象：请求头大小写不敏感，交给标准实现处理。 */
export function deriveDedupKey(eventType: string, headers: Headers, payload: unknown): DedupKey {
  const idempotency = trimmed(headers.get(IDEMPOTENCY_HEADER));
  if (idempotency) return clamp(eventType, 'idempotency-key', `idem:${idempotency}`);
  const uuid = trimmed(headers.get(EVENT_UUID_HEADER));
  if (uuid) return clamp(eventType, 'event-uuid', `uuid:${uuid}`);
  return clamp(eventType, 'payload-fingerprint', `sha256:${fingerprint(payload)}`);
}

/** 超长时整体压成摘要：宁可牺牲可读性，也不能截断——截断会让两个不同事件撞成同一个键。 */
function clamp(eventType: string, source: DedupSource, suffix: string): DedupKey {
  const key = `${eventType}|${suffix}`;
  if (key.length <= MAX_DEDUP_KEY_LENGTH) return { key, source };
  return { key: `${eventType}|sha256:${sha256(key)}`, source };
}

/** 对能稳定标识事件的字段取摘要；整份 payload 里有随机排序与易变字段，不能直接哈希。 */
export function fingerprint(payload: unknown): string {
  const root = asRecord(payload);
  const attributes = asRecord(root?.object_attributes);
  const parts = [
    ...FINGERPRINT_FIELDS.map((field) => `${field}=${scalar(root?.[field])}`),
    ...ATTRIBUTE_FIELDS.map((field) => `oa.${field}=${scalar(attributes?.[field])}`),
    `project=${scalar(asRecord(root?.project)?.id)}`,
  ];
  return sha256(parts.join('\n'));
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** 只取标量：对象与数组在 GitLab 的 payload 里顺序不稳，进指纹会让同一事件算出不同的键。 */
function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function trimmed(value: string | null): string | null {
  const text = value?.trim() ?? '';
  return text.length > 0 ? text : null;
}
