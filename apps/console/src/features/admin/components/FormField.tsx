import type { ReactElement } from 'react';
import styles from './FormField.module.css';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

export interface FormFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** 给出选项时渲染下拉，否则渲染文本框；值一律是字符串，由调用方窄化。 */
  readonly options?: readonly FieldOption[];
  readonly placeholder?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly inputMode?: 'numeric';
}

export function FormField({ label, value, onChange, options, placeholder, title, disabled = false, inputMode }: FormFieldProps): ReactElement {
  return (
    <label className={styles.field} title={title}>
      {label}
      {options === undefined ? (
        <input
          className={styles.control}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <select className={styles.control} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}
