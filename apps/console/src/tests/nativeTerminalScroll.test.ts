import './domSetup';
import { expect, test } from 'bun:test';
import { NativeTerminalSurface } from '../features/dev-session/model/native/nativeTerminalSurface';

function mountSurface(overflow: boolean) {
  const container = document.createElement('div');
  document.body.append(container);
  // DOM 测试环境没有排版；这里复现实机只读小窗的外层滚动尺寸。
  Object.defineProperties(container, {
    clientWidth: { value: 302 }, scrollWidth: { value: overflow ? 1088 : 302 },
    clientHeight: { value: 365 }, scrollHeight: { value: overflow ? 422 : 365 },
  });
  const input: string[] = [];
  const surface = new NativeTerminalSurface();
  surface.mount(container, (data) => input.push(data), () => {});
  const content = container.querySelector<HTMLElement>('.xterm-screen')!;
  let delivered = 0;
  content.addEventListener('wheel', () => { delivered++; });
  return { surface, input, delivered: () => delivered, wheel: (deltaX: number, deltaY: number) => {
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
