import type { ProjectDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { useRepositoryBinding } from '../model/useRepositoryBinding';

/**
 * 项目信息卡：平台为项目分配的标识，放在项目信息组最上面直接展示（2026-09-23 作者裁定，原为折叠的「技术详情」）。
 * 「仓库」一行是新窗口打开的外链（2026-09-23 作者裁定：概览页头不再放仓库链接，移到这里）；「—」只表示开通未完成、
 * 还没有仓库，读取中或读取失败写「暂未读取到」，不冒充没有仓库（失败原因见下方源码仓库卡）。
 */
export function ProjectInfoCard({ project }: { readonly project: ProjectDto }): ReactElement {
  const t = useT();
  const binding = useRepositoryBinding(project.serviceId).data;
  const repository = binding !== undefined
    ? <a href={binding.httpUrl} target="_blank" rel="noreferrer">{binding.pathWithNamespace} ↗</a>
    : project.serviceId === undefined ? '—' : t('projects.info.repositoryUnread');
  return (
    <Card title={t('projects.info.title')}>
      <DefinitionList
        items={[
          { label: t('projects.info.projectId'), value: <code>{project.id}</code> },
          { label: t('projects.info.serviceId'), value: <code>{project.serviceId ?? '—'}</code> },
          { label: t('projects.info.namespace'), value: <code>{project.namespace}</code> },
          { label: t('projects.info.repository'), value: repository },
        ]}
      />
    </Card>
  );
}
