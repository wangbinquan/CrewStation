import type { ProjectDto } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { useDateText } from '../model/useDateText';
import { ProjectStateBadge } from './ProjectStateBadge';
import styles from './ProjectTable.module.css';

export interface ProjectRowProps {
  readonly project: ProjectDto;
  readonly isAdmin: boolean;
  readonly retrying: boolean;
  readonly onRetry: (projectId: string) => void;
}

/** 一个项目一行；开通失败时紧跟一行说明，把失败的步骤留在原地而不是折进详情页。 */
export function ProjectRow({ project, isAdmin, retrying, onRetry }: ProjectRowProps): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const failed = project.state === 'failed';
  return (
    <>
      <tr>
        <td>
          <Link to="/projects/$projectId" params={{ projectId: project.id }} className={styles.name}>
            {project.name}
          </Link>
        </td>
        <td>
          <code>{project.slug}</code>
        </td>
        <td>{t(`projects.kind.${project.kind}`)}</td>
        <td>
          <ProjectStateBadge state={project.state} />
        </td>
        <td>
          <code>{project.namespace}</code>
        </td>
        <td className={styles.nowrap}>{dateText(project.createdAt)}</td>
        <td>
          {isAdmin && failed ? (
            <Button onClick={() => onRetry(project.id)} disabled={retrying}>
              {retrying ? t('projects.list.retrying') : t('projects.list.retryProvision')}
            </Button>
          ) : null}
        </td>
      </tr>
      {failed && project.message !== undefined ? (
        <tr>
          <td className={styles.failure} colSpan={7}>
            {t('projects.list.failureLabel')}
            {project.message}
          </td>
        </tr>
      ) : null}
    </>
  );
}
