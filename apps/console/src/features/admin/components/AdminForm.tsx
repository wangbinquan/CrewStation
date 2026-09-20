import type { ReactElement, ReactNode } from 'react';
import { Button } from '../../../shared/ui/Button';
import styles from './AdminForm.module.css';

export interface AdminFormProps {
  readonly submitLabel: string;
  readonly busyLabel: string;
  readonly busy: boolean;
  /** 必填项没填齐时为 true，提交按钮保持禁用，不靠浏览器原生校验弹窗。 */
  readonly incomplete: boolean;
  readonly note?: string;
  readonly error?: ReactNode;
  readonly onSubmit: () => void;
  readonly children: ReactNode;
  readonly extraActions?: ReactNode;
}

/** 管理页各分区新增表单的外壳：字段自动换行排布，提交按钮与说明在下方。 */
export function AdminForm({ submitLabel, busyLabel, busy, incomplete, note, error, onSubmit, children, extraActions }: AdminFormProps): ReactElement {
  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.fields}>{children}</div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" disabled={busy || incomplete}>
          {busy ? busyLabel : submitLabel}
        </Button>
        {extraActions}
        {note === undefined ? null : <span className={styles.note}>{note}</span>}
      </div>
      {error === undefined || error === null ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
