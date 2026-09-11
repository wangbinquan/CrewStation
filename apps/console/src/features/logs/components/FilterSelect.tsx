import type { ReactElement } from 'react';
import styles from './FilterSelect.module.css';

export interface FilterOption {
  readonly value: string;
  readonly label: string;
}

export interface FilterSelectProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly FilterOption[];
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly title?: string;
}

/** 日志筛选条里的一个下拉：值一律是字符串，由调用方窄化成具体的联合类型。 */
export function FilterSelect({ label, value, options, onChange, disabled = false, title }: FilterSelectProps): ReactElement {
  return (
    <label className={styles.field} title={title}>
      {label}
      <select className={styles.select} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
