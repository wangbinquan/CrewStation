import type { ReactElement, ReactNode } from 'react';
import styles from './DefinitionList.module.css';

export interface Fact {
  readonly label: string;
  readonly value: ReactNode;
}

/** 名值对：部署槽、配额与仓库卡片共用同一种两栏排版。 */
export function DefinitionList({ facts }: { readonly facts: readonly Fact[] }): ReactElement {
  return (
    <dl className={styles.facts}>
      {facts.map((fact) => (
        <div key={fact.label} className={styles.row}>
          <dt className={styles.label}>{fact.label}</dt>
          <dd className={styles.value}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
