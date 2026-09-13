import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import type * as XtermHeadless from '@xterm/headless';
import { createTerminalScreen, TERMINAL_SCROLLBACK_LIMIT } from '../src/terminal/terminalScreen';
import { createTerminalControl, TERMINAL_CONTROL_LEASE_MS } from '../src/terminal/terminalControl';

const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof XtermHeadless;

test('快照恢复颜色、光标、备用屏幕及跨片段 ANSI；序号与已解析屏幕一致', async () => {
  const screen = createTerminalScreen(40, 8);
  const restored = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  try {
    await screen.write('normal screen\r\n\x1b[?1049h\x1b[H\x1b[31', 1);
    const writing = screen.write('mCLI 提示\x1b[0m\x1b[3;4Hanswer', 2);
    const snapshot = await screen.snapshot();
    await writing;
    expect(snapshot.throughSeq).toBe(2);
    await new Promise<void>((resolve) => restored.write(snapshot.data, resolve));
    expect(restored.buffer.active.type).toBe('alternate');
    expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe('CLI 提示');
    expect(restored.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(1);
    expect(restored.buffer.active.getLine(2)?.translateToString(true)).toBe('   answer');
    expect(restored.buffer.active.cursorX).toBe(9);
    expect(restored.buffer.active.cursorY).toBe(2);
    expect(snapshot.truncated).toBe(false);
    await new Promise<void>((resolve) => restored.write('\x1b[?1049l', resolve));
    expect(restored.buffer.active.getLine(0)?.translateToString(true)).toBe('normal screen');
  } finally { await screen.dispose(); restored.dispose(); }
});

test('回放有界且明确标记已淘汰滚动历史，调整尺寸后快照使用实际尺寸', async () => {
  const screen = createTerminalScreen(40, 8);
  try {
    await screen.write(Array.from({ length: 800 }, (_, i) => `line ${i}\r\n`).join(''), 1);
    await screen.resize(60, 12);
    const snapshot = await screen.snapshot();
    expect(snapshot).toMatchObject({ cols: 60, rows: 12, throughSeq: 1, truncated: true, scrollbackLimit: TERMINAL_SCROLLBACK_LIMIT });
    expect(snapshot.data).not.toContain('line 1\r');
    expect(snapshot.data).toContain('line 799');
    expect(Buffer.byteLength(snapshot.data)).toBeLessThan(40_000);
  } finally { await screen.dispose(); }
});

test('多个视图只有一个输入／尺寸控制，错误视图 detach 不抢控制，断线租约到期可重新取得', () => {
  let time = 100_000;
  const lease = createTerminalControl(() => time);
  expect(lease.claim('one').controlled).toBe(true);
  expect(lease.claim('two').controlled).toBe(false);
  expect(() => lease.assert('two')).toThrow('未取得');
  lease.release('two');
  lease.assert('one');
  time += TERMINAL_CONTROL_LEASE_MS;
  expect(() => lease.assert('one')).toThrow('未取得');
  expect(lease.claim('two').controlled).toBe(true);
  lease.release('two');
  expect(lease.claim('one').controlled).toBe(true);
});
