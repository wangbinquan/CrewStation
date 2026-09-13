import type { ReactElement } from 'react';
import styles from './GlyphIcon.module.css';

export type GlyphName = 'station' | 'assistant' | 'workflow' | 'book' | 'chart' | 'spark';
const paths: Record<GlyphName, string> = {
  station: 'M18 4H8a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4h10M9 8h9M9 12h7M9 16h9',
  assistant: 'M8 6h8a4 4 0 0 1 4 4v7H4v-7a4 4 0 0 1 4-4ZM12 3v3M8 11v2M16 11v2M8 20h8',
  workflow: 'M4 4h6v6H4ZM14 14h6v6h-6ZM10 7h7v7M7 10v7h7',
  book: 'M12 5v16M12 5C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1Z',
  chart: 'M4 4v16h17M8 16v-5M13 16V7M18 16v-8',
  spark: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
};

/** 固定本地矢量符号，继承主题色；可用于应用卡片与选择器。 */
export function GlyphIcon({ name, label }: { readonly name: GlyphName; readonly label?: string }): ReactElement {
  return <span className={styles.icon}><svg viewBox="0 0 24 24" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg></span>;
}
