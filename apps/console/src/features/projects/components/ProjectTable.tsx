import type { ProjectDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { ProjectRow } from './ProjectRow';

export interface ProjectTableProps {
  readonly projects: readonly ProjectDto[];
  readonly isAdmin: boolean;
}

export function ProjectTable({ projects, isAdmin }: ProjectTableProps): ReactElement {
  const t = useT();
  const columns = [
    t('projects.list.columnName'), t('projects.list.columnSlug'), t('projects.list.columnKind'), t('projects.list.columnState'),
    t('projects.list.columnNamespace'), t('projects.list.columnCreatedAt'), t('projects.list.columnActions'),
  ];
  return (
    <>
      <DataTable columns={columns}>
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            isAdmin={isAdmin}
          />
        ))}
      </DataTable>
    </>
  );
}
