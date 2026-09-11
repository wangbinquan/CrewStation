import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import styles from './InlineConfirm.module.css';

export interface InlineConfirmProps {
  readonly label: string;
  readonly question: string;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly onConfirm: () => void;
}

/**
 * 两段式确认：先点一次展开问句，再点确认才执行。
 * 不用 window.confirm——原生弹窗会卡住调试工作台用的浏览器自动化。
 */
export function InlineConfirm({ label, question, busy = false, busyLabel, onConfirm }: InlineConfirmProps): ReactElement {
  const t = useT();
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <Button disabled={busy} onClick={() => setArmed(true)}>
        {busy ? (busyLabel ?? label) : label}
      </Button>
    );
  }
  return (
    <span className={styles.confirm}>
      <span className={styles.question}>{question}</span>
      <Button
        variant="primary"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {t('admin.confirm.yes')}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        {t('admin.confirm.no')}
      </Button>
    </span>
  );
}
