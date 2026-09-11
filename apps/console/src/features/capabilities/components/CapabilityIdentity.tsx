import type { CapabilityDescriptionDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { CapabilitySection } from './CapabilitySection';
import { PairList } from './PairList';

export interface CapabilityIdentityProps {
  readonly service: CapabilityDescriptionDto['service'];
  readonly hosts: CapabilityDescriptionDto['hosts'];
}

/** 服务身份与各域名：网关判定调用方用的就是这里的 identity。 */
export function CapabilityIdentity({ service, hosts }: CapabilityIdentityProps): ReactElement {
  const t = useT();
  return (
    <>
      <CapabilitySection title={t('capabilities.service.title')} note={t('capabilities.service.note')}>
        <PairList
          pairs={[
            { label: t('capabilities.service.identity'), value: service.identity },
            { label: t('capabilities.service.slug'), value: service.slug },
            { label: t('capabilities.service.namespace'), value: service.namespace },
          ]}
        />
      </CapabilitySection>
      <CapabilitySection title={t('capabilities.hosts.title')} note={t('capabilities.hosts.note')}>
        <PairList
          pairs={[
            { label: t('capabilities.hosts.prod'), value: hosts.prod },
            { label: t('capabilities.hosts.preview'), value: hosts.preview },
            { label: t('capabilities.hosts.dev'), value: hosts.dev },
            { label: t('capabilities.hosts.service'), value: hosts.service },
            { label: t('capabilities.hosts.platformApi'), value: hosts.platformApi },
          ]}
        />
      </CapabilitySection>
    </>
  );
}
