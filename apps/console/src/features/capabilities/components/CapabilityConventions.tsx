import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CapabilitySection } from './CapabilitySection';
import { PairList, pairsFromRecord } from './PairList';
import styles from './CapabilityConventions.module.css';

type Conventions = CapabilityDescriptionDto['conventions'];
type Forwarding = CapabilityDescriptionDto['identityForwarding'];

/** 约定表的四组来自同一个对象；顺序固定，便于和集成约定文档对照。 */
const GROUPS: readonly (keyof Conventions)[] = ['identityHeaders', 'env', 'paths', 'eventHeaders'];

export function CapabilityConventions({ conventions, forwarding }: { readonly conventions: Conventions; readonly forwarding: Forwarding }): ReactElement {
  const t = useT();
  return (
    <CapabilitySection title={t('capabilities.conventions.title')} note={t('capabilities.conventions.note')}>
      {/*
        头名约定表是「名字的契约」；用户身份头里哪些真的会到达本服务由平台的身份转发配置决定，
        所以这一节给的是**当前生效**的集合，而不是一张静态常量表（RFC-005 B10）。
      */}
      <section className={styles.group}>
        <h3 className={styles.title}>{t('capabilities.forwarding.title')}</h3>
        <PairList
          pairs={[
            { label: t('capabilities.forwarding.source'), value: forwarding.source === 'project' ? t('capabilities.forwarding.sourceProject') : t('capabilities.forwarding.sourceGlobal') },
            { label: t('capabilities.forwarding.headers'), value: forwarding.headers.join(' ') },
            { label: t('capabilities.forwarding.claims'), value: forwarding.tokenClaims.length === 0 ? t('capabilities.forwarding.none') : forwarding.tokenClaims.join(' ') },
          ]}
        />
      </section>
      {GROUPS.map((group) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.title}>{t(`capabilities.conventions.${group}`)}</h3>
          <PairList pairs={pairsFromRecord(conventions[group])} />
        </section>
      ))}
    </CapabilitySection>
  );
}
