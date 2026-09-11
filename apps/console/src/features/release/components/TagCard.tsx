import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { useDateText } from '../model/useDateText';
import { DataTable } from './DataTable';
import { QueryStatus } from './QueryStatus';

/** 仓库里的全部标签；只有平台创建的 v<major>.<minor>.<patch> 会触发发布。 */
export function TagCard({ serviceId }: { readonly serviceId: string }): ReactElement {
  const t = useT();
  const dateText = useDateText();
  // queryKeys 还没有标签这一项；沿用 ['services', serviceId, …] 前缀，失效规则保持一致。
  const tags = useApiQuery(['services', serviceId, 'tags'], () => api.services.listTags(serviceId));
  const items = tags.data?.items ?? [];
  const headers = [t('release.tags.columnName'), t('release.tags.columnCommit'), t('release.tags.columnCreatedAt')];
  return (
    <Card title={t('release.tags.title')}>
      <QueryStatus isPending={tags.isPending} error={tags.error} loadingKey="release.tags.loading" errorKey="release.tags.error" />
      {items.length === 0 && !tags.isPending && tags.error === null ? <p>{t('release.tags.empty')}</p> : null}
      {items.length > 0 ? (
        <DataTable headers={headers}>
          {items.map((tag) => (
            <tr key={tag.name}>
              <td>
                <code>{tag.name}</code>
                {tag.protected ? <Badge tone="info">{t('release.tags.protected')}</Badge> : null}
              </td>
              <td>
                <code>{tag.commitSha.slice(0, 7)}</code>
              </td>
              <td>{dateText(tag.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
