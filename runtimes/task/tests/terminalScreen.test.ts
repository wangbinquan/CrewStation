import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import type * as XtermHeadless from '@xterm/headless';
import { createTerminalScreen, TERMINAL_SCROLLBACK_LIMIT } from '../src/terminal/terminalScreen';
import { createTerminalControl, TERMINAL_CONTROL_LEASE_MS } from '../src/terminal/terminalControl';

const { Terminal } = createRequire(import.meta.url)('@xterm/headless') as typeof XtermHeadless;

test.each([1006, 1016])('重新连接时保留鼠标编码 %s，原生 Agent 仍能识别滚轮与拖动', async (mode) => {
  const screen = createTerminalScreen(80, 24);
  try {
    // OpenCode 在备用屏幕内自行滚动历史；只有鼠标 tracking 而没有 SGR 编码会让它读错事件。
    await screen.write(`\x1b[?1049h\x1b[?1003h\x1b[?${mode}`, 1);
    await screen.write('hAgent history', 2);
    const snapshot = await screen.snapshot();
    expect(snapshot.data).toContain('\x1b[?1003h');
    expect(snapshot.data).toContain(`\x1b[?${mode}h`);
    expect(snapshot.throughSeq).toBe(2);
  } finally { await screen.dispose(); }
});

const mouseCases = [
  { name: 'SGR 与 tracking 合并设置', data: '\x1b[?1003;1006h', sgr: 1, pixels: 2 },
  { name: '后设置的像素模式优先', data: '\x1b[?1006;1016h', sgr: 2, pixels: 1 },
  { name: '后设置的 SGR 模式优先', data: '\x1b[?1016;1006h', sgr: 1, pixels: 2 },
  { name: '关闭任一编码恢复默认', data: '\x1b[?1016h\x1b[?1006l', sgr: 2, pixels: 2 },
  { name: '关闭像素编码', data: '\x1b[?1016h\x1b[?1016l', sgr: 2, pixels: 2 },
  { name: '硬复位清除鼠标模式', data: '\x1b[?1006h\x1bc', sgr: 2, pixels: 2 },
  { name: '软复位保持鼠标编码', data: '\x1b[?1006h\x1b[!p', sgr: 1, pixels: 2 },
];
for (const item of mouseCases) test(`快照恢复实际鼠标状态：${item.name}`, async () => {
  const screen = createTerminalScreen(80, 24), restored = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  try {
    await screen.write(item.data, 1);
    const snapshot = await screen.snapshot();
    await new Promise<void>((resolve) => restored.write(snapshot.data, resolve));
    const replies: string[] = [];
    restored.onData((data) => replies.push(data));
    await new Promise<void>((resolve) => restored.write('\x1b[?1006$p\x1b[?1016$p', resolve));
    expect(replies).toEqual([`\x1b[?1006;${item.sgr}$y`, `\x1b[?1016;${item.pixels}$y`]);
  } finally { await screen.dispose(); restored.dispose(); }
});

test('采集快照不打断尚未写完的鼠标转义序列', async () => {
  const screen = createTerminalScreen(80, 24);
  try {
    await screen.write('\x1b[?1006', 1);
    expect((await screen.snapshot()).data).toEndWith('\x1b[?1006l');
    await screen.write('h', 2);
    expect((await screen.snapshot()).data).toEndWith('\x1b[?1006h');
  } finally { await screen.dispose(); }
});

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
