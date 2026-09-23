import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import styles from './Tabs.module.css';

export interface TabItem { readonly value: string; readonly label: ReactNode }
export interface TabsProps {
  readonly label: string;
  readonly items: readonly TabItem[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
  readonly extra?: ReactNode;
  /** 在纵向弹性父级里长满：页签正文跟着内容长、最后一项长满（工具面板里内容短时把最后一张卡拉到面板底边）。 */
  readonly fill?: boolean;
}

/** 受控页签：方向键／Home／End 切换，标签与面板关联；窄屏只滚动标签条。 */
export function Tabs({ label, items, value, onChange, children, extra, fill = false }: TabsProps): ReactElement {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.findIndex((item) => item.value === value));
  useLayoutEffect(() => {
    const bar = list.current;
    if (!bar) return;
    const reveal = () => revealTab(bar, bar.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'));
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [value, items]);
  return <div className={fill ? `${styles.tabs} ${styles.fill}` : styles.tabs}>
    <div className={styles.bar}><div className={styles.list} role="tablist" aria-label={label} ref={list}
      onFocus={(event) => revealTab(event.currentTarget, event.target.closest<HTMLElement>('[role="tab"]'))} onKeyDown={(event) => {
      const target = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined;
      if (target === undefined || !items[target]) return;
      event.preventDefault();
      // 先让焦点滚动生效，再导航；否则 Router 会快照旧位置并把新焦点滚回可视区外。
      const button = list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target];
      button?.focus();
      if (list.current) revealTab(list.current, button ?? null);
      onChange(items[target].value);
    }}>
      {items.map((item, i) => <Button key={item.value} id={`${id}-tab-${i}`} role="tab" aria-selected={item.value === value} aria-controls={`${id}-panel`} tabIndex={item.value === value ? 0 : -1} variant={item.value === value ? 'secondary' : 'ghost'} onClick={() => onChange(item.value)}>{item.label}</Button>)}
    </div>{extra ? <div className={styles.extra}>{extra}</div> : null}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} className={styles.panel}>{children}</div>
  </div>;
}

/** focus 不保证滚动嵌套标签条；只调整本条的横向位置，不改变页面或内容区的滚动。 */
function revealTab(list: HTMLElement, tab: HTMLElement | null): void {
  if (!tab || list.clientWidth === 0) return;
  const left = list.getBoundingClientRect().left + list.clientLeft, right = left + list.clientWidth;
  const item = tab.getBoundingClientRect();
  if (item.left < left) list.scrollLeft += item.left - left;
  else if (item.right > right) list.scrollLeft += Math.min(item.right - right, item.left - left);
}
