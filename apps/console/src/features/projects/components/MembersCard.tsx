import { useT } from '../../../shared/lib/useT';
import { errorMessage } from '../../../shared/api/useApi';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { useMemberPanel } from '../model/useMemberPanel';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useMemberManagement } from '../model/useMemberManagement';
import type { ProjectOwnership } from '../model/useProjectOwnership';
import { MemberForm } from './MemberForm';

export interface MembersCardProps {
  readonly projectId: string;
  readonly ownership: ProjectOwnership;
}

export function MembersCard({ projectId, ownership }: MembersCardProps) {
  const { isOwner: canManage, isAdmin } = ownership;
  const t = useT(), management = useMemberManagement(projectId, canManage && !ownership.unavailable);
  const { members, save, remove, pending, unavailable } = management, items = members.data?.items ?? [];
  const editor = useMemberPanel();
  const blocked = pending || unavailable || ownership.unavailable;
  const columns = [t('projects.members.columnName'), t('projects.members.columnEmail'), t('projects.members.columnRole'), t('projects.members.columnActions')];
  return <Card stacked compact title={t('projects.members.title')} extra={canManage ? <Button variant="primary" disabled={blocked} onClick={() => editor.select(null)}>{t('projects.members.add')}</Button> : undefined}>
    <QueryStatus isPending={members.isPending} error={ownership.error ?? members.error} loadingKey="projects.members.loading" errorKey="projects.members.error" />
    {ownership.error ? <ActionNote tone="neutral">{t('projects.members.identityUnconfirmed')}</ActionNote> : !canManage ? <p>{t('projects.members.readOnly')}</p> : null}
    {pending ? <ActionNote tone="neutral">{t('projects.members.pendingNote')}</ActionNote> : null}
    {items.length === 0 && !members.isPending && !members.error ? <p>{t('projects.members.empty')}</p> : null}
    {items.length > 0 ? <DataTable columns={columns}>{items.map((member) => <tr key={member.userId}>
      <td>{member.name}</td><td>{member.email}</td>
      <td><Badge tone={member.role === 'owner' ? 'info' : 'neutral'}>{t(`projects.role.${member.role}`)}</Badge></td>
      <td><ActionRow>{canManage && (member.role !== 'owner' || isAdmin) ? <Button size="small" disabled={blocked} onClick={() => editor.select(member)}>{t('projects.members.editRole')}</Button> : null}{canManage && member.role !== 'owner' ? <InlineConfirm variant="danger" size="small" label={t('projects.members.remove')} question={t('projects.members.removeQuestion', { name: member.name, email: member.email })} confirmLabel={t('projects.members.confirmRemove')} busy={pending || unavailable || ownership.unavailable} onConfirm={() => { void management.removeMember(member); }} /> : member.role === 'owner' ? t('projects.members.currentOwner') : null}</ActionRow></td>
    </tr>)}</DataTable> : null}
    {save.isError ? <ActionNote tone="error">{t('projects.members.saveError', { message: errorMessage(save.error) })}</ActionNote> : null}
    {remove.isError ? <ActionNote tone="error">{t('projects.members.removeError', { message: errorMessage(remove.error) })}</ActionNote> : null}
    {save.isSuccess ? <ActionNote tone="success">{t('projects.members.saved', { name: save.data.name, role: t(`projects.role.${save.data.role}`) })}</ActionNote> : null}
    {remove.isSuccess ? <ActionNote tone="success">{t('projects.members.removed', { name: remove.data.name })}</ActionNote> : null}
    {editor.switching ? <ConfirmationDialog question={t('projects.members.discardQuestion')} confirmLabel={t('projects.members.discard')} cancelLabel={t('ui.draft.stay')} busy={pending} focus="cancel" onConfirm={editor.confirm} onCancel={editor.keep} /> : null}
    {editor.member !== undefined ? <MemberForm key={editor.sequence} open={editor.open} initialMember={editor.member ?? undefined} projectId={projectId} isAdmin={isAdmin} canManage={canManage} members={items} pending={pending} disabled={unavailable || ownership.unavailable || editor.switching} onSave={async (input) => { const result = await management.saveMember(input); if (result) editor.close(); return result; }} onDirtyChange={editor.dirtyChanged} onClose={editor.hide} onClear={editor.clear} /> : null}
  </Card>;
}
