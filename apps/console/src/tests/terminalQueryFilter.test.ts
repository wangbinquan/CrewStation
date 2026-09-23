import './domSetup';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalSnapshot } from '@crewstation/contracts';
import { TERMINAL_REPLY_PALETTE } from '@crewstation/contracts';
import { NativeTerminalSurface } from '../features/dev-session/model/native/nativeTerminalSurface';

// RFC-026：新 Runner 统一应答终端查询；浏览器 xterm 若照旧应答，CLI 会收到两份，多出的一份作为乱码进 TUI 输入框，
// 应答还会给输入控制续租。这里锁住：快照声明 repliesQueries 时浏览器拦下查询、键盘输入照常；旧 Runner（没有声明）照旧应答。

const snapshot = (repliesQueries?: boolean): TerminalSnapshot => ({
  terminalId: 't', runnerId: '0199a3c0-0000-7000-8000-000000000001', cols: 80, rows: 24, throughSeq: 0, data: '', scrollbackLimit: 500, truncated: false,
  ...(repliesQueries === undefined ? {} : { repliesQueries }),
});

async function mounted(repliesQueries?: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  const input: string[] = [];
  const surface = new NativeTerminalSurface('opencode');
  surface.mount(container, (data) => input.push(data), () => {});
  surface.setControlled(true);
  await surface.restore(snapshot(repliesQueries));
  const settle = () => new Promise<void>((resolve) => { surface.write(''); setTimeout(resolve, 20); });
  return { surface, input, settle, dispose: () => { surface.dispose(); container.remove(); } };
}

const QUERIES = ['\x1b[c', '\x1b[>c', '\x1b[6n', '\x1b[?2026$p', '\x1b]10;?\x07', '\x1b]11;?\x07', '\x1b]12;?\x07', '\x1b]4;1;?\x07', '\x1bP$qm\x1b\\'];

test('Runner 声明由它应答：浏览器对 DA／DSR／DECRQM／DECRQSS／配色查询一条都不应答', async () => {
  const page = await mounted(true);
  try {
    for (const query of QUERIES) page.surface.write(query);
    await page.settle();
    expect(page.input).toEqual([]);
  } finally { page.dispose(); }
});

test('拦截不碰键盘输入，也不吞掉设置颜色等非查询序列', async () => {
  const page = await mounted(true);
  try {
    (page.surface as unknown as { terminal: { input(data: string): void } }).terminal.input('hi\r');
    page.surface.write('\x1b]11;#101010\x07\x1b]4;1;#ff0000\x07');
    await page.settle();
    expect(page.input).toEqual(['hi\r']);
  } finally { page.dispose(); }
});

test('旧 Runner（快照没有 repliesQueries）：浏览器照旧应答；同一个终端再附着到新 Runner 时改为拦下', async () => {
  const page = await mounted(undefined);
  try {
    page.surface.write('\x1b[c');
    await page.settle();
    expect(page.input).toEqual(['\x1b[?1;2c']);
    await page.surface.restore(snapshot(true));
    page.surface.write('\x1b[c');
    await page.settle();
    expect(page.input).toEqual(['\x1b[?1;2c']);
    await page.surface.restore(snapshot(false));
    page.surface.write('\x1b[6n');
    await page.settle();
    expect(page.input).toEqual(['\x1b[?1;2c', '\x1b[1;1R']);
  } finally { page.dispose(); }
});

test('Runner 应答的配色与工作台深色主题令牌一致（改 tokens.css 深色段时这里提醒同步 TERMINAL_REPLY_PALETTE）', () => {
  const css = readFileSync(join(import.meta.dir, '..', 'app', 'theme', 'tokens.css'), 'utf8');
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  const token = (name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(dark)?.[1];
  expect({ foreground: token('--cs-color-text'), background: token('--cs-color-surface'), cursor: token('--cs-color-primary') }).toEqual({ ...TERMINAL_REPLY_PALETTE });
});
