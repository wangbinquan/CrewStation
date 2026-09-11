import type { ProjectDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { DataTable } from '../../../shared/ui/DataTable';
import { retryProvisioning } from '../model/provisionRequest';
import { ProjectRow } from './ProjectRow';

export interface ProjectTableProps {
  readonly projects: readonly ProjectDto[];
  readonly isAdmin: boolean;
}

export function ProjectTable({ projects, isAdmin }: ProjectTableProps): ReactElement {
  const t = useT();
  // 重开通是后台作业：返回 202 后项目回到 provisioning，失效列表即可看到新状态。
  const retry = useApiMutation((projectId: string) => retryProvisioning(projectId), { invalidate: [queryKeys.projects()] });
  const columns = [
    t('projects.list.columnName'), t('projects.list.columnSlug'), t('projects.list.columnKind'), t('projects.list.columnState'),
    t('projects.list.columnNamespace'), t('projects.list.columnCreatedAt'), t('projects.list.columnActions'),
  ];
  return (
    <>
      {retry.isError ? <ActionNote tone="error">{t('projects.list.retryFailed', { message: errorMessage(retry.error) })}</ActionNote> : null}
      {retry.isSuccess ? <ActionNote tone="success">{t('projects.list.retryQueued')}</ActionNote> : null}
      <DataTable columns={columns}>
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            isAdmin={isAdmin}
            retrying={retry.isPending && retry.variables === project.id}
            onRetry={retry.mutate}
          />
        ))}
      </DataTable>
    </>
  );
}
