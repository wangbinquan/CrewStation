import { PREVIEW_LOG_LIMITS } from '@crewstation/contracts';
import { expect, test } from 'bun:test';
import { createPreviewOutputBuffer } from './previewOutputBuffer';

const at = (n: number) => new Date(Date.UTC(2026, 8, 21, 0, 0, n));

function buffer(): ReturnType<typeof createPreviewOutputBuffer> {
  let tick = 0;
  return createPreviewOutputBuffer({ now: () => at(tick++) });
}

test('按写入顺序取尾部，limit 只影响返回条数不影响保留', () => {
  const b = buffer();
  for (let i = 0; i < 10; i += 1) b.push('stdout', `line ${i}`, 1);
  expect(b.read({ limit: 3 }).lines.map((l) => l.text)).toEqual(['line 7', 'line 8', 'line 9']);
  expect(b.read({ limit: 100 }).lines).toHaveLength(10);
  expect(b.read({ limit: 3 }).dropped).toBe(0);
});

test('按 stream 过滤，时间戳与 attempt 逐行保留', () => {
  const b = buffer();
  b.push('stdout', 'out', 1);
  b.push('stderr', 'err', 2);
  expect(b.read({ limit: 10, stream: 'stderr' }).lines).toEqual([{ at: at(1).toISOString(), stream: 'stderr', attempt: 2, text: 'err' }]);
  expect(b.read({ limit: 10, stream: 'stdout' }).lines.map((l) => l.text)).toEqual(['out']);
});

test('超过行数上限从头丢弃并累计 dropped', () => {
  const b = buffer();
  const total = PREVIEW_LOG_LIMITS.maxLines + 5;
  for (let i = 0; i < total; i += 1) b.push('stdout', `l${i}`, 1);
  const read = b.read({ limit: PREVIEW_LOG_LIMITS.maxLines });
  expect(read.lines).toHaveLength(PREVIEW_LOG_LIMITS.maxLines);
  expect(read.lines[0]?.text).toBe('l5');
  expect(read.dropped).toBe(5);
});

test('超过字节上限也从头丢弃，行数远未触顶', () => {
  const b = buffer();
  // 取满单行上限（8 KiB）的行，免得先被单行截断影响字节账；32 行即 256 KiB，第 33 行把最早的挤掉。
  const chunk = 'x'.repeat(PREVIEW_LOG_LIMITS.maxLineBytes);
  const fits = PREVIEW_LOG_LIMITS.maxBytes / PREVIEW_LOG_LIMITS.maxLineBytes;
  for (let i = 0; i < fits + 1; i += 1) b.push('stdout', chunk, 1);
  const read = b.read({ limit: PREVIEW_LOG_LIMITS.maxLines });
  expect(read.lines.length).toBeLessThan(PREVIEW_LOG_LIMITS.maxLines);
  expect(read.lines).toHaveLength(fits);
  expect(read.dropped).toBe(1);
});

test('单行超长按字节截断并标记，不返回半个多字节字符', () => {
  const b = buffer();
  // 每个「预」3 字节；用它铺满超过上限，确保切点落在字符中间。
  b.push('stdout', '预'.repeat(PREVIEW_LOG_LIMITS.maxLineBytes), 1);
  const line = b.read({ limit: 1 }).lines[0]!;
  expect(line.truncated).toBe(true);
  expect(line.text).not.toContain('�');
  expect(new TextEncoder().encode(line.text).length).toBeLessThanOrEqual(PREVIEW_LOG_LIMITS.maxLineBytes);
  expect(line.text.length).toBeGreaterThan(0);
});

test('恰好等于单行上限不截断', () => {
  const b = buffer();
  b.push('stdout', 'y'.repeat(PREVIEW_LOG_LIMITS.maxLineBytes), 1);
  expect(b.read({ limit: 1 }).lines[0]?.truncated).toBeUndefined();
});

test('跨重启保留旧 attempt 的行，靠 attempt 分辨是哪一次运行', () => {
  const b = buffer();
  b.push('stderr', 'crash before restart', 1);
  b.push('stdout', 'listening', 2);
  expect(b.read({ limit: 10 }).lines.map((l) => [l.attempt, l.text])).toEqual([[1, 'crash before restart'], [2, 'listening']]);
});
