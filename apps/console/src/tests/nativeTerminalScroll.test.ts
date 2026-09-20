import './domSetup';
import { expect, test } from 'bun:test';
import type { AgentProtocol } from '@crewstation/contracts';
import { NativeTerminalSurface } from '../features/dev-session/model/native/nativeTerminalSurface';

function mountSurface(overflow: boolean, protocol?: AgentProtocol) {
  const container = document.createElement('div');
  document.body.append(container);
  // DOM 测试环境没有排版；这里复现实机只读小窗的外层滚动尺寸。
  Object.defineProperties(container, {
    clientWidth: { value: 302 }, scrollWidth: { value: overflow ? 1088 : 302 },
    clientHeight: { value: 365 }, scrollHeight: { value: overflow ? 422 : 365 },
  });
  const input: string[] = [];
  let reply: ((data: string) => void) | undefined;
  const surface = new NativeTerminalSurface(protocol);
  surface.mount(container, (data) => { input.push(data); reply?.(data); }, () => {});
  const content = container.querySelector<HTMLElement>('.xterm-screen')!;
  let delivered = 0;
  content.addEventListener('wheel', () => { delivered++; });
  return { surface, input, mode: (value: number) => new Promise<string>((resolve) => {
    reply = (data) => { reply = undefined; resolve(data); };
    surface.write(`\x1b[?${value}$p`);
  }), delivered: () => delivered, wheel: (deltaX: number, deltaY: number) => {
    const event = new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
    content.dispatchEvent(event);
    return event;
  }, dispose: () => { surface.dispose(); container.remove(); } };
}

for (const [axis, x, y] of [['horizontal', 120, 0], ['vertical', 0, 120]] as const) {
  test(`只读窄终端的 ${axis} 滚动交给外层，不被 xterm 吞掉`, () => {
    const page = mountSurface(true);
    try {
      const event = page.wheel(x, y);
      // 实机正文滚轮无效，只有 4px 边缘可滚动；原 PTY 尺寸必须保留。
      expect(page.delivered()).toBe(0);
      expect(event.defaultPrevented).toBe(false);
      expect(page.input).toEqual([]);
    } finally { page.dispose(); }
  });
}

test('没有外层溢出的只读窗口仍交给 xterm 处理回看', () => {
  const page = mountSurface(false);
  try {
    page.wheel(0, 120);
    expect(page.delivered()).toBe(1);
    expect(page.input).toEqual([]);
  } finally { page.dispose(); }
});

test('获取和释放输入控制同步切换滚轮归属，保留原终端', () => {
  const page = mountSurface(true);
  try {
    page.surface.setControlled(true);
    page.wheel(120, 0);
    expect(page.delivered()).toBe(1);
    page.surface.setControlled(false);
    const event = page.wheel(120, 0);
    expect(page.delivered()).toBe(1);
    expect(event.defaultPrevented).toBe(false);
    expect(page.input).toEqual([]);
  } finally { page.dispose(); }
});


const snapshots: Array<{ name: string; protocol?: AgentProtocol; data: string; mode: number; state: number }> = [
  { name: '旧 OpenCode 快照补全 SGR', protocol: 'opencode', data: '\x1b[?1049h\x1b[?1003h', mode: 1006, state: 1 },
  { name: '明确使用默认编码时不补全', protocol: 'opencode', data: '\x1b[?1003h\x1b[?1006l', mode: 1006, state: 2 },
  { name: '保留像素坐标编码', protocol: 'opencode', data: '\x1b[?1003;1016h', mode: 1016, state: 1 },
  { name: 'OpenCode 尚未开启鼠标时不补全', protocol: 'opencode', data: 'starting', mode: 1006, state: 2 },
  ...(['terminal', 'claude-code', undefined] as const).map((protocol) => ({ name: `${protocol ?? '未知'} 协议不推断编码`, protocol, data: '\x1b[?1003h', mode: 1006, state: 2 })),
];
for (const item of snapshots) test(`恢复快照：${item.name}`, async () => {
  const page = mountSurface(false, item.protocol);
  try {
    page.surface.setControlled(true);
    // 老 Runner 的快照只有 tracking，OpenCode 需要 SGR；明确保存的编码和其他协议不能被覆盖。
    await page.surface.restore({ terminalId: 'pty', runnerId: 'runner', cols: 80, rows: 24,
      data: item.data, throughSeq: 8, truncated: false, scrollbackLimit: 500 });
    expect(await page.mode(item.mode)).toBe(`\x1b[?${item.mode};${item.state}$y`);
  } finally { page.dispose(); }
});
