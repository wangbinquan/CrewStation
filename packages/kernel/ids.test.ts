import { expect, test } from 'bun:test';
import { newResourceId, newTraceId } from './ids';

test('平台资源生成完整、小写且互不重复的 UUIDv7', () => {
  const ids = Array.from({ length: 1000 }, () => newResourceId());
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const timestamp = parseInt(ids[0]!.replaceAll('-', '').slice(0, 12), 16);
  expect(Math.abs(Date.now() - timestamp)).toBeLessThan(10_000);
});

test('资源 ID 变更仍保留 traceId 的 32 位协议形状', () => {
  expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
});
