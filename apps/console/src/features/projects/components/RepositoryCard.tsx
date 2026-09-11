import type { RepositoryBindingDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from './DefinitionList';
import type { Fact } from './DefinitionList';
import { QueryStatus } from './QueryStatus';

function repositoryTone(state: RepositoryBindingDto['state']): BadgeTone {
  if (state === 'ready') return 'success';
  return state === 'failed' ? 'warning' : 'info';
}

/** 一个服务 ↔ 一个托管仓库；建不出来时 message 说明卡在哪一步。 */
export function RepositoryCard({ serviceId }: { readonly serviceId: string }): ReactElement {
  const t = useT();
  // queryKeys 还没有仓库绑定这一项；沿用 ['services', serviceId, …] 前缀，失效规则保持一致。
  const repository = useApiQuery(['services', serviceId, 'repository'], () => api.services.getRepository(serviceId));
  const binding = repository.data;
  const facts: readonly Fact[] = binding === undefined ? [] : [
    { label: t('projects.repository.path'), value: <code>{binding.pathWithNamespace}</code> },
    { label: t('projects.repository.defaultBranch'), value: <code>{binding.defaultBranch}</code> },
    { label: t('projects.repository.state'), value: <Badge tone={repositoryTone(binding.state)}>{t(`projects.repositoryState.${binding.state}`)}</Badge> },
    ...(binding.message === undefined ? [] : [{ label: t('projects.repository.message'), value: binding.message }]),
  ];
  return (
    <Card
      title={t('projects.repository.title')}
      extra={binding === undefined ? undefined : (
        <a href={binding.httpUrl} target="_blank" rel="noreferrer">
          {t('projects.repository.open')}
        </a>
      )}
    >
      <QueryStatus isPending={repository.isPending} error={repository.error} loadingKey="projects.repository.loading" errorKey="projects.repository.error" />
      {facts.length > 0 ? <DefinitionList facts={facts} /> : null}
    </Card>
  );
}
