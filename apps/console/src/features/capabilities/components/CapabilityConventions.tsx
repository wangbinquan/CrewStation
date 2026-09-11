import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CapabilitySection } from './CapabilitySection';
import { PairList, pairsFromRecord } from './PairList';
import styles from './CapabilityConventions.module.css';

type Conventions = CapabilityDescriptionDto['conventions'];

/** 约定表的四组来自同一个对象；顺序固定，便于和集成约定文档对照。 */
const GROUPS: readonly (keyof Conventions)[] = ['identityHeaders', 'env', 'paths', 'eventHeaders'];

export function CapabilityConventions({ conventions }: { readonly conventions: Conventions }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.conventions.title')} note={t('capabilities.conventions.note')}>
      {GROUPS.map((group) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.title}>{t(`capabilities.conventions.${group}`)}</h3>
          <PairList pairs={pairsFromRecord(conventions[group])} />
        </section>
      ))}
    </CapabilitySection>
  );
}
