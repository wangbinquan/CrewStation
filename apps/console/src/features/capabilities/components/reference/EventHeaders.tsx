import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { ResourceGroup } from '../../../../shared/ui/resource/ResourceList';
import { KeyMeaningList } from './KeyMeaningList';
import { meanings } from './RuntimeReference';

/** 「接收事件」里的一组：推送到处理路径的请求带哪些头（处理端要据投递 ID 做幂等）。 */
export function EventHeaders({ conventions }: { readonly conventions: CapabilityDescriptionDto['conventions'] }): ReactElement {
  const t = useT();
  const items = [...meanings(t, 'event', conventions.eventHeaders), ...meanings(t, 'header', conventions.identityHeaders, ['sourceToken', 'traceId'])];
  return <ResourceGroup plain title={t('capabilities.runtime.eventHeaders')} count={items.length} note={t('capabilities.runtime.eventNote')}>
    <KeyMeaningList label={t('capabilities.runtime.eventHeaders')} items={items} />
  </ResourceGroup>;
}
