import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CopyValue } from './CopyValue';
import styles from './PairList.module.css';

export interface Pair {
  readonly label: string;
  readonly value: string;
}

export interface PairListProps {
  readonly pairs: readonly Pair[];
}

/** 标签＋可复制的值；约定表与地址表都用它，保证复制行为一致。 */
export function PairList({ pairs }: PairListProps): ReactElement {
  const t = useT();
  if (pairs.length === 0) return <p className={styles.muted}>{t('capabilities.empty')}</p>;
  return (
    <dl className={styles.list}>
      {pairs.map((pair) => (
        <div key={pair.label} className={styles.row}>
          <dt className={styles.label}>{pair.label}</dt>
          <dd className={styles.value}>
            <CopyValue value={pair.value} label={pair.label} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 把约定表这类 `Record<string, string>` 转成有序的键值对。 */
export function pairsFromRecord(record: Readonly<Record<string, string>>): readonly Pair[] {
  return Object.entries(record)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
