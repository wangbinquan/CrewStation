import { expect, test } from 'bun:test';
import { TERMINAL_REPLY_PALETTE } from '@crewstation/contracts';
import { paletteAnswers, paletteColor, rgbSpec } from './terminalQueryReplies';
import { createTerminalScreen } from './terminalScreen';

// RFC-026：OpenCode 启动时向终端发一串查询，拿不到应答要等约 8 秒才画界面；以前只有持有输入控制的浏览器窗口应答，
// 没人持有控制时 CLI 一直空白。这些用例锁住 Runner 的无头终端替 CLI 应答，且与浏览器 xterm.js 6 的应答逐条一致（设计 §2 实测）。

async function repliesTo(query: string): Promise<string> {
  const got: string[] = [];
  const screen = createTerminalScreen(80, 24, { reply: (data) => got.push(data) });
  await screen.write(query, 1);
  await screen.dispose();
  return got.join('');
}

test('无头 xterm 自己应答的查询：DA1、DSR、DECRQM（与浏览器 xterm.js 6 一致）', async () => {
  expect(await repliesTo('\x1b[c')).toBe('\x1b[?1;2c');
  expect(await repliesTo('\x1b[3;5H\x1b[6n')).toBe('\x1b[3;5R');
  expect(await repliesTo('\x1b[?2026$p')).toBe('\x1b[?2026;2$y');
  expect(await repliesTo('\x1b[?2027$p')).toBe('\x1b[?2027;0$y');
});

test('补答配色查询：OSC 10／11／12 报工作台深色主题的前景、背景、光标色，BEL 与 ST 结尾都答', async () => {
  expect(await repliesTo('\x1b]10;?\x07')).toBe('\x1b]10;rgb:e7e7/eded/f6f6\x1b\\');
  expect(await repliesTo('\x1b]11;?\x1b\\')).toBe(`\x1b]11;${rgbSpec(TERMINAL_REPLY_PALETTE.background)}\x1b\\`);
  expect(await repliesTo('\x1b]12;?\x07')).toBe('\x1b]12;rgb:3939/7070/dfdf\x1b\\');
});

test('补答调色板查询 OSC 4：单色、多色成对；设置颜色与越界序号不由这里答', async () => {
  expect(await repliesTo('\x1b]4;0;?\x07')).toBe('\x1b]4;0;rgb:2e2e/3434/3636\x1b\\');
  expect(await repliesTo('\x1b]4;1;?;15;?\x07')).toBe('\x1b]4;1;rgb:cccc/0000/0000\x1b\\\x1b]4;15;rgb:eeee/eeee/ecec\x1b\\');
  expect(paletteAnswers('1;#ff0000')).toBeUndefined();
  expect(paletteAnswers('300;?')).toBeUndefined();
  expect(paletteAnswers('1')).toBeUndefined();
  expect(await repliesTo('\x1b]4;1;#ff0000\x07')).toBe('');
});

test('调色板与 xterm.js 默认值一致：16 色、色立方、灰阶（2026-09-23 在浏览器里 256 色逐一核对为 0 差异）', () => {
  expect([0, 7, 8, 15].map(paletteColor)).toEqual(['#2e3436', '#d3d7cf', '#555753', '#eeeeec']);
  expect([16, 21, 196, 231].map(paletteColor)).toEqual(['#000000', '#0000ff', '#ff0000', '#ffffff']);
  expect([232, 255].map(paletteColor)).toEqual(['#080808', '#eeeeee']);
});

test('浏览器 xterm.js 同样不答的查询，这里也不答（XTVERSION、kitty 键盘、窗口像素、OSC 13）', async () => {
  for (const query of ['\x1b[>0q', '\x1b[?u', '\x1b[14t', '\x1b]13;?\x07']) expect(await repliesTo(query)).toBe('');
});

test('快照声明 repliesQueries：有应答方时为 true，没有时不带这一项', async () => {
  const answering = createTerminalScreen(80, 24, { reply: () => {} }), silent = createTerminalScreen(80, 24);
  expect((await answering.snapshot()).repliesQueries).toBe(true);
  expect('repliesQueries' in (await silent.snapshot())).toBe(false);
  await answering.dispose(); await silent.dispose();
});
