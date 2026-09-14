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

test('备用屏幕缩窄后只序列化可见列，隐藏的旧侧栏不能换行挤乱草稿', async () => {
  const screen = createTerminalScreen(40, 8);
  const restored = new Terminal({ cols: 20, rows: 8, allowProposedApi: true });
  const expanded = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  try {
    await screen.write('\x1b[?1049h' + Array.from({ length: 8 }, (_, i) => `\x1b[${i + 1};30HOLD${i}`).join(''), 1);
    await screen.resize(20, 8, 2);
    const rows = Array.from({ length: 8 }, (_, i) => i === 7 ? 'unsent draft' : `row${i}`);
    await screen.write(rows.map((row, i) => `\x1b[${i + 1};1H\x1b[32m${row}\x1b[0m`).join('') + '\x1b[3;6H\x1b[?2004h', 3);
    const snapshot = await screen.snapshot();
    await new Promise<void>((resolve) => restored.write(snapshot.data, resolve));
    // 实机 OpenCode 返回后错位：缩窄仍保留旧行容量，addon 把屏幕外的旧侧栏写入窄快照。
    expect(Array.from({ length: 8 }, (_, i) => restored.buffer.active.getLine(i)?.translateToString(false, 0, 20))).toEqual(rows.map((row) => row.padEnd(20)));
    expect(snapshot.data).not.toContain('OLD');
    expect(snapshot).toMatchObject({ cols: 20, rows: 8, throughSeq: 3 });
    expect(restored.buffer.active.type).toBe('alternate');
    expect(restored.buffer.active.getLine(7)?.getCell(0)?.getFgColor()).toBe(2);
    expect(restored.buffer.active.cursorX).toBe(5); expect(restored.buffer.active.cursorY).toBe(2);
    expect(restored.modes.bracketedPasteMode).toBe(true);

    // 快照投影不能删除原模拟器的屏幕外内容；之后宽屏快照仍与实际缓冲一致。
    await screen.resize(40, 8, 4);
    const wider = await screen.snapshot();
    await new Promise<void>((resolve) => expanded.write(wider.data, resolve));
    expect(expanded.buffer.active.getLine(0)?.translateToString(true, 29, 33)).toBe('OLD0');
    expect(wider.throughSeq).toBe(4);
  } finally { await screen.dispose(); restored.dispose(); expanded.dispose(); }
});

test.each([false, true])('缩窄截到中文字符中间时不挤走下一行，保留颜色=%s', async (colored) => {
  const screen = createTerminalScreen(40, 4);
  const restored = new Terminal({ cols: 20, rows: 4, allowProposedApi: true });
  try {
    await screen.write(`\x1b[?1049h\x1b[1;20H${colored ? '\x1b[31;44m' : ''}界${colored ? '\x1b[0m' : ''}\x1b[2;1H${colored ? '\x1b[32m' : ''}second${colored ? '\x1b[0m' : ''}\x1b[3;1Hdraft`, 1);
    await screen.resize(20, 4, 2);
    const snapshot = await screen.snapshot();
    await new Promise<void>((resolve) => restored.write(snapshot.data, resolve));
    // 完整门禁后补查发现：右边界只剩半个中文字符时，直接输出它仍会多换一行。
    expect(restored.buffer.active.getLine(1)?.translateToString(true)).toBe('second');
    expect(restored.buffer.active.getLine(2)?.translateToString(true)).toBe('draft');
    expect(restored.buffer.active.getLine(0)?.translateToString(false, 0, 20)).toBe(' '.repeat(20));
    expect(restored.buffer.active.cursorX).toBe(5); expect(restored.buffer.active.cursorY).toBe(2);
    if (colored) {
      expect(restored.buffer.active.getLine(0)?.getCell(19)?.getBgColor()).toBe(4);
      expect(restored.buffer.active.getLine(1)?.getCell(0)?.getFgColor()).toBe(2);
    }
  } finally { await screen.dispose(); restored.dispose(); }
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
