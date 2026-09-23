import type { ProjectDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';

/** 项目信息卡：平台为项目分配的标识，放在项目信息组最上面直接展示（2026-09-23 作者裁定，原为折叠的「技术详情」）。 */
export function ProjectInfoCard({ project }: { readonly project: ProjectDto }): ReactElement {
  const t = useT();
  return (
    <Card title={t('projects.info.title')}>
      <DefinitionList
        items={[
          { label: t('projects.info.projectId'), value: <code>{project.id}</code> },
          { label: t('projects.info.serviceId'), value: <code>{project.serviceId ?? '—'}</code> },
          { label: t('projects.info.namespace'), value: <code>{project.namespace}</code> },
        ]}
      />
    </Card>
  );
}
