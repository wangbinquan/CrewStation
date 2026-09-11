import type { ReactElement, ReactNode } from 'react';
import styles from './FormField.module.css';

export interface FormFieldProps {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}

/** 表单的一格：标签包住控件，点标签即聚焦，不需要手工维护 id。 */
export function FormField({ label, hint, children }: FormFieldProps): ReactElement {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
      {hint !== undefined ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
}
