import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MutationError } from './MutationError';

interface SetAdminInput {
  readonly userId: string;
  readonly isAdmin: boolean;
}

/** 用户目录与管理员标记；账号本身由公司登录带入，这里只改标记。 */
export function UsersSection(): ReactElement {
  const t = useT();
  const users = useApiQuery(queryKeys.users(), () => api.users.list());
  const setAdmin = useApiMutation((input: SetAdminInput) => api.users.setAdmin(input.userId, { isAdmin: input.isAdmin }), { invalidate: [queryKeys.users()] });
  const items = users.data?.items ?? [];
  return (
    <Card title={t('admin.users.title')} footer={t('admin.users.hint')}>
      <MutationError error={setAdmin.error} messageKey="admin.users.saveError" />
      <QueryStatus
        isPending={users.isPending}
        error={users.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.users.emptyTitle')}
        emptyDescription={t('admin.users.emptyDescription')}
      />
      {items.length > 0 ? (
        <DataTable columns={[t('admin.users.name'), t('admin.users.email'), t('admin.users.admin'), t('admin.users.actions')]}>
          {items.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td>{user.email}</td>
              <td>
                <Badge tone={user.isAdmin ? 'info' : 'neutral'}>{user.isAdmin ? t('admin.users.yes') : t('admin.users.no')}</Badge>
              </td>
              <td>
                <InlineConfirm
                  label={user.isAdmin ? t('admin.users.revoke') : t('admin.users.grant')}
                  question={user.isAdmin ? t('admin.users.revokeQuestion') : t('admin.users.grantQuestion')}
                  busy={setAdmin.isPending && setAdmin.variables?.userId === user.id}
                  busyLabel={t('admin.users.saving')}
                  onConfirm={() => setAdmin.mutate({ userId: user.id, isAdmin: !user.isAdmin })}
                />
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
    </Card>
  );
}
