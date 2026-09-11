import { describe, expect, test } from 'bun:test';
import { deriveOccurredAt, parseTimestamp } from './occurredAt';

const NOW = new Date('2026-09-12T00:00:00.000Z');

describe('parseTimestamp', () => {
  test('认得 GitLab 的两种写法', () => {
    expect(parseTimestamp('2026-09-11T08:00:00Z')).toBe('2026-09-11T08:00:00.000Z');
    expect(parseTimestamp('2026-09-11 08:00:00 UTC')).toBe('2026-09-11T08:00:00.000Z');
    expect(parseTimestamp('2026-09-11T08:00:00+08:00')).toBe('2026-09-11T00:00:00.000Z');
  });

  test('解析不了就返回 null', () => {
    expect(parseTimestamp('明天')).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp(1757577600)).toBeNull();
  });
});

describe('deriveOccurredAt', () => {
  test('流水线优先取 finished_at，其次 updated_at、created_at', () => {
    const attributes = { finished_at: '2026-09-11 08:30:00 UTC', updated_at: '2026-09-11 08:20:00 UTC', created_at: '2026-09-11 08:10:00 UTC' };
    expect(deriveOccurredAt({ object_attributes: attributes }, NOW)).toBe('2026-09-11T08:30:00.000Z');
    expect(deriveOccurredAt({ object_attributes: { updated_at: attributes.updated_at, created_at: attributes.created_at } }, NOW)).toBe('2026-09-11T08:20:00.000Z');
    expect(deriveOccurredAt({ object_attributes: { created_at: attributes.created_at } }, NOW)).toBe('2026-09-11T08:10:00.000Z');
  });

  test('push 没有 object_attributes：取最后一个提交的时间戳', () => {
    const payload = { commits: [{ timestamp: '2026-09-11T07:00:00Z' }, { timestamp: '2026-09-11T07:05:00Z' }] };
    expect(deriveOccurredAt(payload, NOW)).toBe('2026-09-11T07:05:00.000Z');
  });

  test('全都取不到时退回接收时刻，且永远是合法的 ISO 串', () => {
    expect(deriveOccurredAt({}, NOW)).toBe(NOW.toISOString());
    expect(deriveOccurredAt({ commits: [] }, NOW)).toBe(NOW.toISOString());
    expect(deriveOccurredAt({ object_attributes: { updated_at: '不是时间' } }, NOW)).toBe(NOW.toISOString());
    expect(deriveOccurredAt(null, NOW)).toBe(NOW.toISOString());
  });
});
