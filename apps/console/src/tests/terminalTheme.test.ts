import './domSetup';
import { expect, spyOn, test } from 'bun:test';
import { NativeTerminalSurface } from '../features/dev-session/model/native/nativeTerminalSurface';
import { openTerminalSession } from '../features/dev-session/model/terminalSession';

const COLOR_PREFERENCE = '(prefers-color-scheme: dark)';
const LIGHT = '#fffdf8';
const DARK = '#13232f';

function mountTerminal(kind: 'native' | 'shell') {
  const container = document.createElement('div');
  container.style.setProperty('--cs-color-surface', LIGHT);
  document.body.append(container);
  const commands: string[] = [];
  let dispose: () => void;
  if (kind === 'native') {
    const surface = new NativeTerminalSurface();
    surface.mount(container, () => commands.push('input'), () => commands.push('resize'));
    dispose = () => surface.dispose();
  } else {
    const session = openTerminalSession({ container, terminalId: 'theme-shell', send: async (command) => { commands.push(command.type); return {}; }, onInput: () => {}, onError: () => {} });
    dispose = () => session.dispose();
  }
  const element = container.querySelector<HTMLElement>('.xterm')!;
  const canvas = container.querySelector<HTMLElement>('.xterm-scrollable-element')!;
  return { container, element, commands, background: () => getComputedStyle(canvas).backgroundColor, dispose, remove: () => container.remove() };
}

function colorPreference() {
  const original = window.matchMedia.bind(window);
  const media = original(COLOR_PREFERENCE);
  const lookup = spyOn(window, 'matchMedia').mockImplementation((query) => query === COLOR_PREFERENCE ? media : original(query));
  const added = spyOn(media, 'addEventListener');
  const removed = spyOn(media, 'removeEventListener');
  return { media, added, removed, restore: () => { lookup.mockRestore(); added.mockRestore(); removed.mockRestore(); } };
}

for (const kind of ['native', 'shell'] as const) {
  test(`${kind} 终端随系统主题更新已挂载画面，不重建终端或发送 PTY 命令`, () => {
    const preference = colorPreference();
    const terminal = mountTerminal(kind);
    const originalCommands = [...terminal.commands];
    try {
      expect(terminal.background()).toBe(LIGHT);
      // 系统媒体条件改变不会修改根元素属性；已打开的 xterm 不能继续使用旧配色。
      terminal.container.style.setProperty('--cs-color-surface', DARK);
      preference.media.dispatchEvent(new Event('change'));
      expect(terminal.background()).toBe(DARK);
      terminal.container.style.setProperty('--cs-color-surface', LIGHT);
      preference.media.dispatchEvent(new Event('change'));
      expect(terminal.background()).toBe(LIGHT);
      expect(terminal.container.querySelector('.xterm')).toBe(terminal.element);
      expect(terminal.commands).toEqual(originalCommands);
    } finally { terminal.dispose(); terminal.remove(); preference.restore(); }
  });

  test(`${kind} 终端保留根元素主题属性更新路径`, async () => {
    const terminal = mountTerminal(kind);
    const root = document.documentElement;
    const original = root.getAttribute('data-theme');
    try {
      terminal.container.style.setProperty('--cs-color-surface', DARK);
      root.setAttribute('data-theme', 'terminal-test-dark');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(terminal.background()).toBe(DARK);
      expect(terminal.container.querySelector('.xterm')).toBe(terminal.element);
    } finally {
      terminal.dispose(); terminal.remove();
      if (original === null) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', original);
    }
  });

  test(`${kind} 终端卸载时移除系统主题监听，后续变化不再触碰旧实例`, () => {
    const preference = colorPreference();
    const terminal = mountTerminal(kind);
    try {
      const registration = preference.added.mock.calls.find(([type]) => type === 'change');
      expect(registration).toBeDefined();
      terminal.dispose();
      expect(preference.removed.mock.calls.some(([type, listener]) => type === 'change' && listener === registration?.[1])).toBe(true);
      const commandsAfterDispose = [...terminal.commands];
      expect(() => preference.media.dispatchEvent(new Event('change'))).not.toThrow();
      expect(terminal.commands).toEqual(commandsAfterDispose);
    } finally { terminal.dispose(); terminal.remove(); preference.restore(); }
  });
}

test('关闭一份终端不会移除另一份终端的系统主题监听', () => {
  const preference = colorPreference();
  const first = mountTerminal('native');
  const second = mountTerminal('shell');
  try {
    first.container.style.setProperty('--cs-color-surface', DARK);
    second.container.style.setProperty('--cs-color-surface', DARK);
    preference.media.dispatchEvent(new Event('change'));
    expect(first.background()).toBe(DARK);
    expect(second.background()).toBe(DARK);
    first.dispose();
    second.container.style.setProperty('--cs-color-surface', LIGHT);
    preference.media.dispatchEvent(new Event('change'));
    expect(second.background()).toBe(LIGHT);
    expect(second.container.querySelector('.xterm')).toBe(second.element);
  } finally { first.dispose(); second.dispose(); first.remove(); second.remove(); preference.restore(); }
});
