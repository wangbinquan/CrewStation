import { describe, expect, test } from 'bun:test';
import { err, mapResult, ok, unwrap } from './result';
import { newId, newTraceId } from './ids';

describe('Result', () => {
  test('ok 可映射并解包', () => {
    expect(unwrap(mapResult(ok(2), (v) => v * 2))).toBe(4);
  });
  test('err 解包抛出原错误', () => {
    const error = new Error('boom');
    expect(() => unwrap(err(error))).toThrow(error);
  });
});

describe('ids', () => {
  test('带前缀且时间有序', () => {
    const a = newId('prj');
    const b = newId('prj');
    expect(a.startsWith('prj_')).toBe(true);
    expect(a < b).toBe(true);
  });
  test('traceId 为 32 位十六进制', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
  });
});
