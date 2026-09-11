import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import styles from './CopyValue.module.css';

type CopyState = 'idle' | 'copied' | 'failed';

export interface CopyValueProps {
  readonly value: string;
  /** 复制按钮的无障碍名称，通常是这一项的标签。 */
  readonly label: string;
}

/** 可复制的值：行内提示 1.5 秒后自行消失，不弹任何对话框。 */
export function CopyValue({ value, label }: CopyValueProps): ReactElement {
  const t = useT();
  const [state, setState] = useState<CopyState>('idle');
  const flash = (next: CopyState): void => {
    setState(next);
    window.setTimeout(() => setState('idle'), 1500);
  };
  if (value.length === 0) return <span className={styles.muted}>{t('capabilities.empty')}</span>;
  return (
    <span className={styles.wrapper}>
      <code className={styles.value}>{value}</code>
      <button
        type="button"
        className={styles.button}
        aria-label={`${t('capabilities.copy')} ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => flash('copied'),
            () => flash('failed'),
          );
        }}
      >
        {t('capabilities.copy')}
      </button>
      <span className={styles.hint} role="status" aria-live="polite">
        {state === 'copied' ? t('capabilities.copied') : state === 'failed' ? t('capabilities.copyFailed') : ''}
      </span>
    </span>
  );
}
