import { useId } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { FormField } from '../FormField';
import styles from './SectionNavigation.module.css';

interface SectionItem { readonly value: string; readonly label: string; readonly description: string }
/** 次级导航在窄屏变为有标签的原生选择框，每次只呈现一组内容。 */
export function SectionNavigation({ label, items, value, onChange, children }: {
  readonly label: string; readonly items: readonly SectionItem[]; readonly value: string;
  readonly onChange: (value: string) => void; readonly children: ReactNode;
}) {
  const id = useId();
  return <div className={styles.layout}>
    <nav className={styles.navigation} aria-label={label}>
      {items.map((item) => <Button key={item.value} variant={item.value === value ? 'secondary' : 'ghost'} aria-current={item.value === value ? 'page' : undefined} aria-controls={id} onClick={() => onChange(item.value)}>
        <span>{item.label}</span><small>{item.description}</small>
      </Button>)}
    </nav>
    <div className={styles.mobile}><FormField label={label}><select value={value} aria-controls={id} onChange={(event) => onChange(event.target.value)}>{items.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></FormField></div>
    <div className={styles.content} id={id}>{children}</div>
  </div>;
}
