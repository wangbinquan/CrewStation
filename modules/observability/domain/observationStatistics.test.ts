// RFC-034 v2 §5：按需聚合的纯函数——最近秩分位、按浏览器偏移切的连续日桶、不透明的键集游标。
import { expect, test } from 'bun:test';
import { dayIndex, dayIndexes, dayLabel, decodeCursor, encodeCursor, nearestRank } from './observationStatistics';

test('nearest-rank percentiles of sorted samples', () => {
  expect(nearestRank([], 0.5)).toBeNull();
  expect(nearestRank([10, 20, 30, 40], 0.5)).toBe(20);
  expect(nearestRank([10, 20, 30, 40], 0.95)).toBe(40);
  expect(nearestRank([7], 0.95)).toBe(7);
});

test('day buckets follow the browser offset and cover the window without holes', () => {
  const lateUtc = Date.parse('2026-10-13T17:30:00.000Z');
  expect(dayLabel(dayIndex(lateUtc, 0))).toBe('2026-10-13');
  expect(dayLabel(dayIndex(lateUtc, 480))).toBe('2026-10-14');
  expect(dayLabel(dayIndex(lateUtc, -300))).toBe('2026-10-13');
  const days = dayIndexes(Date.parse('2026-10-07T08:00:00.000Z'), Date.parse('2026-10-14T08:00:00.000Z'), 480).map(dayLabel);
  expect(days).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']);
  expect(dayIndexes(Date.parse('2026-10-14T00:00:00.000Z'), Date.parse('2026-10-15T00:00:00.000Z'), 0).map(dayLabel)).toEqual(['2026-10-14']);
});

test('cursors round-trip and reject anything that is not the expected shape', () => {
  const shape = (value: unknown[]): value is [number, string] => value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'string';
  expect(decodeCursor(encodeCursor([1_700_000_000_000, 'task-1']), shape)).toEqual([1_700_000_000_000, 'task-1']);
  expect(decodeCursor(undefined, shape)).toBeNull();
  expect(() => decodeCursor(encodeCursor(['x', 1]), shape)).toThrow(RangeError);
  expect(() => decodeCursor('not json', shape)).toThrow(RangeError);
});
