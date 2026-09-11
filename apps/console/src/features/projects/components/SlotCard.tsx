import type { SlotDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { DefinitionItem } from '../../../shared/ui/DefinitionList';
import { shortSha, slotStateTone } from '../model/projectStateTone';

/** 一个部署槽的现状；两个槽共享生产数据，差别只在网关把用户域流量路由到哪一个。 */
export function SlotCard({ slot }: { readonly slot: SlotDto }): ReactElement {
  const t = useT();
  const facts: readonly DefinitionItem[] = [
    { label: t('projects.slot.release'), value: slot.tag ?? t('projects.slot.empty') },
    { label: t('projects.slot.commit'), value: <code>{shortSha(slot.commitSha)}</code> },
    { label: t('projects.slot.replicas'), value: t('projects.slot.replicasValue', { ready: slot.readyReplicas, total: slot.replicas }) },
    { label: t('projects.slot.state'), value: <Badge tone={slotStateTone(slot.state)}>{t(`projects.slotState.${slot.state}`)}</Badge> },
    {
      label: t('projects.slot.host'),
      // 槽的 host 是裸主机名；用协议相对地址跟随当前页面的 http／https。
      value: (
        <a href={`//${slot.host}`} target="_blank" rel="noreferrer">
          {slot.host}
        </a>
      ),
    },
  ];
  return (
    <Card
      title={t(`projects.slot.${slot.name}`)}
      extra={<Badge tone={slot.active ? 'success' : 'neutral'}>{t(slot.active ? 'projects.slot.active' : 'projects.slot.standby')}</Badge>}
    >
      <DefinitionList items={facts} />
    </Card>
  );
}
