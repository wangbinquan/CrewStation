import type { UserId } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { MemberForm } from './MemberForm';

export interface MembersCardProps {
  readonly projectId: string;
  readonly canManage: boolean;
  readonly isAdmin: boolean;
}

export function MembersCard({ projectId, canManage, isAdmin }: MembersCardProps): ReactElement {
  const t = useT();
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const remove = useApiMutation((userId: UserId) => api.projects.removeMember(projectId, userId), { invalidate: [queryKeys.members(projectId)] });
  const items = members.data?.items ?? [];
  const columns = [t('projects.members.columnName'), t('projects.members.columnEmail'), t('projects.members.columnRole'), t('projects.members.columnActions')];
  return (
    <Card title={t('projects.members.title')}>
      <QueryStatus isPending={members.isPending} error={members.error} loadingKey="projects.members.loading" errorKey="projects.members.error" />
      {items.length === 0 && !members.isPending && members.error === null ? <p>{t('projects.members.empty')}</p> : null}
      {items.length > 0 ? (
        <DataTable columns={columns}>
          {items.map((member) => (
            <tr key={member.userId}>
              <td>{member.name}</td>
              <td>{member.email}</td>
              <td>
                <Badge tone={member.role === 'owner' ? 'info' : 'neutral'}>{t(`projects.role.${member.role}`)}</Badge>
              </td>
              <td>
                {canManage ? (
                  <Button onClick={() => remove.mutate(member.userId)} disabled={remove.isPending}>
                    {t('projects.members.remove')}
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </DataTable>
      ) : null}
      {remove.isError ? <ActionNote tone="error">{t('projects.members.removeError', { message: errorMessage(remove.error) })}</ActionNote> : null}
      {canManage ? <MemberForm projectId={projectId} isAdmin={isAdmin} /> : null}
    </Card>
  );
}
