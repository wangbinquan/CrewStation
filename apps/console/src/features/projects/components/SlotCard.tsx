import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import styles from './SlotCard.module.css';

/** 两个部署槽的名字是固定的：preview（待机）与 prod（生产流量）。 */
export type SlotName = 'preview' | 'prod';

export function SlotCard({ slot }: { readonly slot: SlotName }): ReactElement {
  const t = useT();
  return (
    <Card
      title={t(`projects.slot.${slot}`)}
      extra={<Badge tone={slot === 'prod' ? 'success' : 'info'}>{t(`projects.slot.${slot}Role`)}</Badge>}
    >
      <p className={styles.description}>{t(`projects.slot.${slot}Description`)}</p>
      <dl className={styles.facts}>
        <dt>{t('projects.slot.currentRelease')}</dt>
        <dd>{t('projects.slot.unknown')}</dd>
      </dl>
    </Card>
  );
}
