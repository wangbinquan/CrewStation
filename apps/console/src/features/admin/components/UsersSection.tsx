import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { UserRoleEditor } from './roles/UserRoleEditor';
import { QueryStatus } from '../../../shared/ui/QueryStatus';

/** 用户目录与管理员标记；账号本身由公司登录带入，这里只改标记。 */
export function UsersSection(): ReactElement {
  const t = useT();
  const users = useApiQuery(queryKeys.users(), () => api.users.list());

  const items = users.data?.items ?? [];
  return (
    <Card title={t('admin.users.title')} footer={t('admin.users.hint')}>
      <QueryStatus
        isPending={users.isPending}
        error={users.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.users.emptyTitle')}
        emptyDescription={t('admin.users.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={[t('admin.users.name'), t('admin.users.email'), t('admin.users.role'), t('admin.users.actions')]}>
          {items.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <Badge tone={user.isAdmin ? 'info' : 'neutral'}>{t(`topBar.role.${user.platformRole}`)}</Badge>
              </td>
              <td>
                <UserRoleEditor user={user} refresh={() => void users.refetch()} />
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
