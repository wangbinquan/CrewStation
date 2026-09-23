import type * as XtermHeadless from '@xterm/headless';
import { TERMINAL_REPLY_PALETTE } from '@crewstation/contracts';

/**
 * RFC-026：CLI 的终端查询由 Runner 的无头终端统一应答，与有没有人打开页面、谁持有输入控制无关。
 * OpenCode 启动时发一串查询，拿不到应答要等约 8 秒超时才画界面；以前只有持有控制的浏览器窗口应答。
 *
 * 应答与浏览器 xterm.js 6 逐条一致（设计 §2 实测）：DA／DSR／DECRQM 等由无头 xterm 自己答（经 onData 发出）；
 * 它没有主题服务、不答配色查询，这里补答 OSC 10／11／12（前景、背景、光标）与 OSC 4（调色板）。
 */
export function installQueryReplies(terminal: XtermHeadless.Terminal, reply: (data: string) => void): { dispose(): void } {
  const colors: Record<number, string> = { 10: TERMINAL_REPLY_PALETTE.foreground, 11: TERMINAL_REPLY_PALETTE.background, 12: TERMINAL_REPLY_PALETTE.cursor };
  const disposables = [
    terminal.onData(reply),
    ...[10, 11, 12].map((ident) => terminal.parser.registerOscHandler(ident, (data) => {
      if (data !== '?') return false;
      reply(`\x1b]${ident};${rgbSpec(colors[ident]!)}\x1b\\`);
      return true;
    })),
    terminal.parser.registerOscHandler(4, (data) => {
      const answers = paletteAnswers(data);
      if (!answers) return false;
      reply(answers);
      return true;
    }),
  ];
  return { dispose: () => { for (const disposable of disposables) disposable.dispose(); } };
}

/** OSC 4 的参数是「序号;规格」成对出现；全部是查询（`?`）才由这里答，含设置颜色的交给 xterm 默认处理。 */
export function paletteAnswers(data: string): string | undefined {
  const parts = data.split(';');
  if (parts.length < 2 || parts.length % 2 !== 0) return undefined;
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const index = Number(parts[i]);
    if (parts[i + 1] !== '?' || !Number.isInteger(index) || index < 0 || index > 255) return undefined;
    out += `\x1b]4;${index};${rgbSpec(paletteColor(index))}\x1b\\`;
  }
  return out;
}

/** xterm.js 的默认调色板：16 色（Tango）、6×6×6 色立方、24 级灰。工作台主题不设 ANSI 色，浏览器答的就是这一套。 */
const ANSI_16 = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
const CUBE = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];

export function paletteColor(index: number): string {
  if (index < 16) return ANSI_16[index]!;
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  if (index < 232) {
    const n = index - 16;
    return `#${hex(CUBE[Math.floor(n / 36)]!)}${hex(CUBE[Math.floor(n / 6) % 6]!)}${hex(CUBE[n % 6]!)}`;
  }
  const gray = 8 + (index - 232) * 10;
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

/** `#rrggbb` → xterm 应答用的 `rgb:rrrr/gggg/bbbb`（每个通道两位重复成四位，与 xterm.js 一致）。 */
export function rgbSpec(color: string): string {
  const channel = (offset: number) => color.slice(offset, offset + 2).repeat(2);
  return `rgb:${channel(1)}/${channel(3)}/${channel(5)}`;
}
