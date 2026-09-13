import { useId, useRef } from 'react';
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
}

/** 受控页签：方向键／Home／End 切换，标签与面板关联；窄屏只滚动标签条。 */
export function Tabs({ label, items, value, onChange, children, extra }: TabsProps): ReactElement {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.findIndex((item) => item.value === value));
  return <div className={styles.tabs}>
    <div className={styles.bar}><div className={styles.list} role="tablist" aria-label={label} ref={list} onKeyDown={(event) => {
      const target = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined;
      if (target === undefined || !items[target]) return;
      event.preventDefault();
      onChange(items[target].value);
      list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
    }}>
      {items.map((item, i) => <Button key={item.value} id={`${id}-tab-${i}`} role="tab" aria-selected={item.value === value} aria-controls={`${id}-panel`} tabIndex={item.value === value ? 0 : -1} variant={item.value === value ? 'secondary' : 'ghost'} onClick={() => onChange(item.value)}>{item.label}</Button>)}
    </div>{extra ? <div className={styles.extra}>{extra}</div> : null}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} className={styles.panel}>{children}</div>
  </div>;
}
