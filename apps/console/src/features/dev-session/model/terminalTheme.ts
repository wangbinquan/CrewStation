import type { ITheme } from '@xterm/xterm';

export interface TerminalLook {
  readonly theme: ITheme;
  readonly fontFamily: string;
  readonly fontSize: number;
}

/**
 * xterm 的配色只能用具体色值，不能用 CSS 变量，所以从挂载元素上读主题令牌的计算值。
 * 令牌仍是唯一来源，深浅色切换时随 tokens.css 一起变。
 */
export function terminalLook(element: HTMLElement): TerminalLook {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
  return {
    theme: {
      background: token('--cs-color-surface', '#ffffff'),
      foreground: token('--cs-color-text', '#1c2128'),
      cursor: token('--cs-color-primary', '#2563eb'),
      cursorAccent: token('--cs-color-surface', '#ffffff'),
      selectionBackground: token('--cs-tone-info-bg', '#dbeafe'),
      selectionForeground: token('--cs-tone-info-fg', '#1d4ed8'),
    },
    fontFamily: token('--cs-font-mono', 'ui-monospace, monospace'),
    fontSize: 13,
  };
}
