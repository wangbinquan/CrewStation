import type { SlotName } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { QueryStatus } from './QueryStatus';
import { SlotCard } from './SlotCard';
import { TrafficSwitchAction } from './TrafficSwitchAction';
import styles from './SlotsSection.module.css';

/** 固定顺序：待机的 preview 在左，承载生产流量的 prod 在右。 */
const SLOT_ORDER: readonly SlotName[] = ['preview', 'prod'];

export interface SlotsSectionProps {
  readonly serviceId: string;
  /** 负责人才显示切流入口；越权与否由服务端裁决，这里只是少给一个按钮。 */
  readonly canSwitch: boolean;
}

export function SlotsSection({ serviceId, canSwitch }: SlotsSectionProps): ReactElement {
  const t = useT();
  const slots = useApiQuery(queryKeys.slots(serviceId), () => api.services.listSlots(serviceId));
  const items = slots.data?.items ?? [];
  const ordered = SLOT_ORDER.flatMap((name) => items.filter((slot) => slot.name === name));
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t('projects.slots.title')}</h2>
        {canSwitch && ordered.length > 0 ? <TrafficSwitchAction serviceId={serviceId} slots={ordered} /> : null}
      </header>
      <QueryStatus isPending={slots.isPending} error={slots.error} loadingKey="projects.slot.loading" errorKey="projects.slot.error" />
      <div className={styles.grid}>
        {ordered.map((slot) => (
          <SlotCard key={slot.name} slot={slot} />
        ))}
      </div>
    </section>
  );
}
