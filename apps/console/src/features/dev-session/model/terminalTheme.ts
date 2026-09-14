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

/** CSS 媒体条件变化不产生属性 mutation；已有终端须同时跟随系统主题与根元素主题覆盖。 */
export function watchTerminalTheme(element: HTMLElement, apply: (theme: ITheme) => void): () => void {
  let active = true;
  const update = (): void => { if (active) apply(terminalLook(element).theme); };
  const observer = new MutationObserver(update);
  observer.observe(element.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  const preference = element.ownerDocument.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  preference?.addEventListener('change', update);
  return () => {
    active = false;
    observer.disconnect();
    preference?.removeEventListener('change', update);
  };
}
