import { useT } from '../../../shared/lib/useT';
import { errorMessage } from '../../../shared/api/useApi';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useMemberManagement } from '../model/useMemberManagement';
import { MemberForm } from './MemberForm';

export interface MembersCardProps {
  readonly projectId: string;
  readonly canManage: boolean;
  readonly isAdmin: boolean;
}

export function MembersCard({ projectId, canManage, isAdmin }: MembersCardProps) {
  const t = useT(), management = useMemberManagement(projectId);
  const { members, save, remove, pending, unavailable } = management, items = members.data?.items ?? [];
  const columns = [t('projects.members.columnName'), t('projects.members.columnEmail'), t('projects.members.columnRole'), t('projects.members.columnActions')];
  return <Card compact title={t('projects.members.title')} extra={<Button disabled={pending || members.isFetching} onClick={() => { void members.refetch(); }}>{t('projects.members.refresh')}</Button>}>
    <QueryStatus isPending={members.isPending} error={members.error} loadingKey="projects.members.loading" errorKey="projects.members.error" />
    {!canManage ? <p>{t('projects.members.readOnly')}</p> : null}
    {items.length === 0 && !members.isPending && !members.error ? <p>{t('projects.members.empty')}</p> : null}
    {items.length > 0 ? <DataTable columns={columns}>{items.map((member) => <tr key={member.userId}>
      <td>{member.name}</td><td>{member.email}</td>
      <td><Badge tone={member.role === 'owner' ? 'info' : 'neutral'}>{t(`projects.role.${member.role}`)}</Badge></td>
      <td>{canManage && member.role !== 'owner' ? <InlineConfirm variant="ghost" label={t('projects.members.remove')} question={t('projects.members.removeQuestion', { name: member.name, email: member.email })} confirmLabel={t('projects.members.confirmRemove')} busy={pending || unavailable} onConfirm={() => { void management.removeMember(member); }} /> : member.role === 'owner' ? t('projects.members.currentOwner') : null}</td>
    </tr>)}</DataTable> : null}
    {save.isError ? <ActionNote tone="error">{t('projects.members.saveError', { message: errorMessage(save.error) })}</ActionNote> : null}
    {remove.isError ? <ActionNote tone="error">{t('projects.members.removeError', { message: errorMessage(remove.error) })}</ActionNote> : null}
    {save.isSuccess ? <ActionNote tone="success">{t('projects.members.saved', { name: save.data.name, role: t(`projects.role.${save.data.role}`) })}</ActionNote> : null}
    {remove.isSuccess ? <ActionNote tone="success">{t('projects.members.removed', { name: remove.data.name })}</ActionNote> : null}
    {canManage ? <MemberForm projectId={projectId} isAdmin={isAdmin} members={items} pending={pending} disabled={unavailable} onSave={management.saveMember} /> : null}
  </Card>;
}
