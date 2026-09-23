import { useEffect, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  readonly key: string;
  readonly label: string;
  /** 右侧的快捷键提示，如 F2。 */
  readonly shortcut?: string;
  readonly disabled?: boolean;
  /** 不可用时的原因（悬停提示）。 */
  readonly hint?: string;
  readonly danger?: boolean;
  /** 这一项前面画一条分隔线。 */
  readonly separated?: boolean;
  readonly onSelect: () => void;
}
export interface ContextMenuProps {
  readonly label: string;
  readonly items: readonly ContextMenuItem[];
  /** 菜单左上角（视口坐标）；放不下时往回收。 */
  readonly at: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
}

/**
 * 浮动菜单（右键菜单或键盘唤出）：打开时焦点在第一个可用项，上下键／Home／End 移动，Enter／空格执行；
 * Escape、Tab、点菜单外面、窗口失焦都关闭，关闭后焦点回到打开它的元素。不用浏览器模态框。
 */
export function ContextMenu({ label, items, at, onClose }: ContextMenuProps): ReactElement {
  const menu = useRef<HTMLDivElement>(null), opener = useRef<Element | null>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const element = menu.current;
    if (!element) return;
    // 贴着视口边缘时往回收：直接改样式，不为量尺寸多渲染一轮。
    const rect = element.getBoundingClientRect(), margin = 8;
    element.style.left = `${Math.max(margin, Math.min(at.x, window.innerWidth - rect.width - margin))}px`;
    element.style.top = `${Math.max(margin, Math.min(at.y, window.innerHeight - rect.height - margin))}px`;
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => { if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus(); };
  }, [at]);
  useEffect(() => {
    const outside = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close.current(); };
    const blur = () => close.current();
    document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', blur); window.addEventListener('resize', blur);
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'ArrowDown' ? (current + 1) % buttons.length : event.key === 'ArrowUp' ? (current - 1 + buttons.length) % buttons.length : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined;
    if (target !== undefined) { event.preventDefault(); buttons[target]?.focus(); return; }
    if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); }
  };
  return createPortal(<div ref={menu} role="menu" aria-label={label} className={styles.menu} style={{ left: at.x, top: at.y }} onKeyDown={keyDown} onContextMenu={(event) => event.preventDefault()}>
    {items.map((item) => <div key={item.key} className={item.separated ? styles.separated : undefined} role="none">
      <button type="button" role="menuitem" className={item.danger ? `${styles.item} ${styles.danger}` : styles.item} disabled={item.disabled} title={item.disabled ? item.hint : undefined}
        onClick={() => { onClose(); item.onSelect(); }}>
        <span>{item.label}</span>{item.shortcut ? <kbd className={styles.shortcut}>{item.shortcut}</kbd> : null}
      </button>
    </div>)}
  </div>, document.body);
}
