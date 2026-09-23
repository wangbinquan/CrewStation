import { describe, expect, test } from 'bun:test';
import { compareTracePositions, decodeTraceCursor, encodeTraceCursor, scannedFloor, windowStart, withinScannedRange } from './tracePaging';
import type { TraceKey } from './traceParts';

const trace = (n: number) => n.toString(16).padStart(32, '0');
const key = (n: number, at: string): TraceKey => ({ traceId: trace(n), firstAt: at, lastAt: at, active: false });

describe('调用链列表的位置与游标', () => {
  test('开始时间新的在前，同一毫秒 traceId 大的在前；游标可原样还原', () => {
    const a = { at: '2026-09-23T10:00:00.000Z', traceId: trace(1) }, b = { at: '2026-09-23T10:00:00.000Z', traceId: trace(2) }, c = { at: '2026-09-23T11:00:00.000Z', traceId: trace(1) };
    expect([a, b, c].sort(compareTracePositions)).toEqual([c, b, a]);
    expect(compareTracePositions(a, { ...a })).toBe(0);
    expect(decodeTraceCursor(encodeTraceCursor(b))).toEqual(b);
  });

  test('没有来源给满时已看到底；给满的来源里取最靠前的那条最后一条作下界', () => {
    expect(scannedFloor([[key(1, '2026-09-23T10:00:00.000Z')], []], 2)).toBeUndefined();
    const environments = [key(9, '2026-09-23T12:00:00.000Z'), key(8, '2026-09-23T11:00:00.000Z')];
    const deliveries = [key(7, '2026-09-23T11:30:00.000Z'), key(6, '2026-09-23T11:10:00.000Z')];
    // 两个来源都给满：投递那边只看到 11:10，任务那边只看到 11:00；11:10 之后的才保证两边都看全了。
    expect(scannedFloor([environments, deliveries], 2)).toEqual({ at: '2026-09-23T11:10:00.000Z', traceId: trace(6) });
    expect(scannedFloor([environments, deliveries.slice(0, 1)], 2)).toEqual({ at: '2026-09-23T11:00:00.000Z', traceId: trace(8) });
  });

  test('本轮范围：比游标更早、不早于下界，两端各自可缺省', () => {
    const cursor = { at: '2026-09-23T12:00:00.000Z', traceId: trace(5) }, floor = { at: '2026-09-23T11:00:00.000Z', traceId: trace(5) };
    expect(withinScannedRange({ at: '2026-09-23T11:30:00.000Z', traceId: trace(1) }, cursor, floor)).toBe(true);
    expect(withinScannedRange(cursor, cursor, floor)).toBe(false);
    expect(withinScannedRange(floor, cursor, floor)).toBe(true);
    expect(withinScannedRange({ at: '2026-09-23T10:59:59.999Z', traceId: trace(9) }, cursor, floor)).toBe(false);
    expect(withinScannedRange({ at: '2026-09-23T13:00:00.000Z', traceId: trace(1) }, undefined, undefined)).toBe(true);
  });

  test('时间范围按有活动算的起点；全部没有起点', () => {
    const now = new Date('2026-09-23T12:00:00.000Z');
    expect(windowStart('1h', now)).toBe('2026-09-23T11:00:00.000Z');
    expect(windowStart('24h', now)).toBe('2026-09-22T12:00:00.000Z');
    expect(windowStart('7d', now)).toBe('2026-09-16T12:00:00.000Z');
    expect(windowStart('all', now)).toBeUndefined();
  });
});
