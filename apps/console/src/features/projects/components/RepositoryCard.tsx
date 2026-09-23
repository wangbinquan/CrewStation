import type { RepositoryBindingDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { DefinitionItem } from '../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ExternalButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { repositoryWebUrl, useRepositoryBinding } from '../model/useRepositoryBinding';

function repositoryTone(state: RepositoryBindingDto['state']): BadgeTone {
  if (state === 'ready') return 'success';
  return state === 'failed' ? 'warning' : 'info';
}

/** 一个服务 ↔ 一个托管仓库；建不出来时 message 说明卡在哪一步。 */
export function RepositoryCard({ serviceId }: { readonly serviceId: string }): ReactElement {
  const t = useT();
  const repository = useRepositoryBinding(serviceId);
  const binding = repository.data;
  const facts: readonly DefinitionItem[] = binding === undefined ? [] : [
    { label: t('projects.repository.path'), value: <code>{binding.pathWithNamespace}</code> },
    { label: t('projects.repository.defaultBranch'), value: <code>{binding.defaultBranch}</code> },
    { label: t('projects.repository.state'), value: <Badge tone={repositoryTone(binding.state)}>{t(`projects.repositoryState.${binding.state}`)}</Badge> },
    ...(binding.message === undefined ? [] : [{ label: t('projects.repository.message'), value: binding.message }]),
  ];
  return (
    <Card
      title={t('projects.repository.title')}
      actions={binding === undefined ? undefined : <ExternalButtonLink href={repositoryWebUrl(binding)}>{t('projects.repository.open')}</ExternalButtonLink>}
    >
      <QueryStatus isPending={repository.isPending} error={repository.error} loadingKey="projects.repository.loading" errorKey="projects.repository.error" />
      {facts.length > 0 ? <DefinitionList items={facts} /> : null}
    </Card>
  );
}
