import { describe, expect, test } from 'bun:test';
import { backoffDelayMs, DEFAULT_BACKOFF } from './backoff';
import { decodeFrame, encodeFrame, FrameDecodeError, peekFrameField, rawFrameToText } from './frames';

interface Ping { type: 'ping'; at: string }

/** 结构上模拟 zod 的 safeParse，验证本包不依赖 zod 也能接入校验钩子。 */
const pingSchema = {
  safeParse(input: unknown) {
    const value = input as Partial<Ping> | null;
    if (value && value.type === 'ping' && typeof value.at === 'string') return { success: true as const, data: value as Ping };
    return { success: false as const, error: { message: 'not a ping' } };
  },
};

describe('帧编解码', () => {
  test('字符串、ArrayBuffer、Uint8Array 三种载荷都能解码', () => {
    const text = encodeFrame({ type: 'ping', at: '2026-09-11T00:00:00.000Z' });
    const bytes = new TextEncoder().encode(text);
    for (const raw of [text, bytes, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)]) {
      const result = decodeFrame(raw, pingSchema);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe('ping');
    }
    expect(rawFrameToText(bytes)).toBe(text);
  });
  test('无效 JSON 与不合 schema 的帧分别报 invalid_json 与 invalid_frame', () => {
    const bad = decodeFrame('{not json', pingSchema);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBeInstanceOf(FrameDecodeError);
    if (!bad.ok) expect(bad.error.reason).toBe('invalid_json');
    const wrong = decodeFrame(encodeFrame({ type: 'pong' }), pingSchema);
    expect(!wrong.ok && wrong.error.reason).toBe('invalid_frame');
  });
  test('peekFrameField 只读判别字段，损坏帧返回 undefined', () => {
    expect(peekFrameField('{"id":"c1","type":"exec"}', 'id')).toBe('c1');
    expect(peekFrameField('{"id":7}', 'id')).toBeUndefined();
    expect(peekFrameField('nope', 'id')).toBeUndefined();
    expect(peekFrameField('[1]', 'id')).toBeUndefined();
  });
});

describe('退避', () => {
  test('按指数增长、封顶于 maxMs、抖动不越界', () => {
    const policy = { baseMs: 100, maxMs: 1000, factor: 2, jitter: 0.5 };
    expect(backoffDelayMs(0, policy, () => 0.5)).toBe(100);
    expect(backoffDelayMs(1, policy, () => 0.5)).toBe(200);
    expect(backoffDelayMs(3, policy, () => 0.5)).toBe(800);
    expect(backoffDelayMs(10, policy, () => 0.5)).toBe(1000);
    expect(backoffDelayMs(2, policy, () => 0)).toBe(200);
    expect(backoffDelayMs(2, policy, () => 1)).toBe(600);
    expect(backoffDelayMs(50, policy, () => 1)).toBe(1000);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const delay = backoffDelayMs(attempt, DEFAULT_BACKOFF);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
    }
  });
});
