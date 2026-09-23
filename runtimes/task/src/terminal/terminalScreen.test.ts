import { expect, test } from 'bun:test';
import { createTerminalScreen } from './terminalScreen';

// RFC-024：判定 CLI 界面是否画出只看屏幕上的可见文字。这里用真的无头 xterm 锁住：终端查询不落屏、按活动缓冲区计数。

test('只有终端查询（DA、DSR、DECRQM、OSC 11）时屏幕上没有可见文字', async () => {
  const screen = createTerminalScreen(80, 24);
  await screen.write('\x1b[c\x1b[6n\x1b[?2026$p\x1b]11;?\x07\x1b[?1049h\x1b[2J\x1b[H', 1);
  expect(await screen.visibleChars()).toBe(0);
  await screen.dispose();
});

test('进入备用屏后按备用屏计数，空白不计', async () => {
  const screen = createTerminalScreen(80, 24);
  await screen.write('boot log\r\n', 1);
  expect(await screen.visibleChars()).toBe(7);
  await screen.write('\x1b[?1049h\x1b[H', 2);
  expect(await screen.visibleChars()).toBe(0);
  await screen.write('\x1b[5;10Hopencode  \x1b[6;10H>  ask anything', 3);
  expect(await screen.visibleChars()).toBe('opencode'.length + '>askanything'.length);
  await screen.write('\x1b[?1049l', 4);
  expect(await screen.visibleChars()).toBe(7);
  await screen.dispose();
});

test('只数视口：滚出屏幕的行不计', async () => {
  const screen = createTerminalScreen(20, 3);
  await screen.write('a\r\nb\r\nc\r\nd\r\n', 1);
  expect(await screen.visibleChars()).toBe(2);
  await screen.dispose();
});
