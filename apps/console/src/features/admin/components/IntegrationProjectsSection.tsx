import type { ReactElement } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { INTEGRATION_KINDS } from '../model/integrationKinds';

/**
 * 接入容器项目（RFC-002）：APIProxy 与 EventProducer。过滤在服务端做，
 * 不是这里 filter——接入容器对普通租户不该出现在任何响应里，前端筛只是不显示、数据仍然发了。
 * 表格自己写一份而不是复用 features/projects 的：feature 之间不互相 import（repository-structure §8）。
 */
export function IntegrationProjectsSection(): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const projects = useApiQuery(queryKeys.projectsByKind(INTEGRATION_KINDS), () => api.projects.list(INTEGRATION_KINDS));
  const items = projects.data?.items ?? [];
  const columns = [t('admin.integrations.name'), t('admin.integrations.slug'), t('admin.integrations.kind'), t('admin.integrations.state'), t('admin.integrations.createdAt')];
  return (
    <Card title={t('admin.integrations.title')} footer={t('admin.integrations.footer')}>
      <QueryStatus
        isPending={projects.isPending}
        error={projects.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.integrations.emptyTitle')}
        emptyDescription={t('admin.integrations.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((project) => (
            <tr key={project.id}>
              <td>
                <Link to="/projects/$projectId" params={{ projectId: project.id }}>
                  {project.name}
                </Link>
              </td>
              <td>
                <code>{project.slug}</code>
              </td>
              <td>
                <Badge tone="info">{project.kind}</Badge>
              </td>
              <td>{project.state}</td>
              <td>{dateText(project.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
