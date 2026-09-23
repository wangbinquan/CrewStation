import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import styles from './Reference.module.css';

export interface KeyMeaning {
  readonly name: string;
  readonly meaning?: string;
  /** 这一项此刻对本服务不生效（如没被转发的身份头）：变灰并写明原因。 */
  readonly inactive?: string;
}

/** 名字＋用途的紧凑两栏：点名字就复制；窄时用途折到名字下面。 */
export function KeyMeaningList({ label, items, empty }: { readonly label: string; readonly items: readonly KeyMeaning[]; readonly empty?: ReactNode }): ReactElement {
  const t = useT(), [copied, setCopied] = useState<string>();
  if (items.length === 0) return <p className={styles.muted}>{empty ?? t('capabilities.empty')}</p>;
  const copy = (name: string) => { void navigator.clipboard.writeText(name).then(() => setCopied(name), () => setCopied(undefined)); };
  return <dl className={styles.keys} aria-label={label}>
    {items.map((item) => <div key={item.name} className={item.inactive ? `${styles.key} ${styles.inactive}` : styles.key}>
      <dt><button type="button" className={styles.name} aria-label={`${t('capabilities.copy')} ${item.name}`} onClick={() => copy(item.name)}>{item.name}</button>
        {copied === item.name ? <span className={styles.copied} role="status">{t('capabilities.copied')}</span> : null}</dt>
      <dd>{[item.meaning, item.inactive].filter(Boolean).join(' · ')}</dd>
    </div>)}
  </dl>;
}
