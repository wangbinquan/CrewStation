import type { ReactElement, ReactNode } from 'react';
import { Button } from './Button';
import styles from './Segmented.module.css';

export interface SegmentedItem {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

export interface SegmentedProps {
  readonly label: string;
  readonly items: readonly SegmentedItem[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** 跟在按钮组后面的说明或附加操作：面包屑、返回上一层。 */
  readonly extra?: ReactNode;
}

/**
 * 同一面板内的视图切换：一组按钮，当前项按下（aria-pressed）。
 * 与 Tabs 的分工：Tabs 换的是页面骨架（页签条＋面板），这里换的只是面板里的内容，形态图的层级切换与资源清单的视图切换都用它。
 */
export function Segmented({ label, items, value, onChange, extra }: SegmentedProps): ReactElement {
  return (
    <div className={styles.group} role="group" aria-label={label}>
      {items.map((item) => (
        <Button key={item.value} variant={item.value === value ? 'secondary' : 'ghost'} aria-pressed={item.value === value} disabled={item.disabled} onClick={() => onChange(item.value)}>
          {item.label}
        </Button>
      ))}
      {extra !== undefined ? <span className={styles.extra}>{extra}</span> : null}
    </div>
  );
}
