import { useState } from 'react';
import type { WorkspaceStatusDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { FormField } from '../../../../shared/ui/FormField';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';

export function CommitReview({ workspace, disabled, busy, error, onCommit }: { readonly workspace: Extract<WorkspaceStatusDto, { status: 'ready' }>;
  readonly disabled: boolean; readonly busy: boolean; readonly error?: string; readonly onCommit: (snapshot: Extract<WorkspaceStatusDto, { status: 'ready' }>, message: string) => Promise<void> }) {
  const t = useT(), [snapshot, setSnapshot] = useState<typeof workspace>(), [message, setMessage] = useState(''), [checked, setChecked] = useState(false);
  const changed = !!snapshot && (snapshot.taskId !== workspace.taskId || snapshot.fingerprint !== workspace.fingerprint);
  const blocked = workspace.uncommittedTruncated || !workspace.headSha || !workspace.branch || workspace.uncommitted.some(file => file.status === 'conflict');
  return <>
    <Button disabled={disabled || blocked || busy} onClick={() => { setSnapshot(workspace); setChecked(false); }}>{t('release.commit.review', { count: workspace.uncommittedCount })}</Button>
    {blocked ? <ActionNote tone="neutral">{t('release.commit.blocked')}</ActionNote> : null}
    {snapshot ? <FormDialog title={t('release.commit.title')} submitLabel={t('release.commit.submit')} busy={busy} error={error}
      submitDisabled={disabled || changed || !checked || !message.trim()} onClose={() => setSnapshot(undefined)} onSubmit={() => void onCommit(snapshot, message)}>
      <p>{t('release.commit.hint')}</p><code>{snapshot.branch} · {snapshot.headSha}</code>
      <ul>{snapshot.uncommitted.map(file => <li key={file.path}><code>{file.status} {file.originalPath ? `${file.originalPath} → ` : ''}{file.path}</code></li>)}</ul>
      <FormField label={t('release.commit.message')}><textarea maxLength={500} value={message} disabled={busy} onChange={event => setMessage(event.target.value)} /></FormField>
      <label><input type="checkbox" checked={checked} disabled={busy} onChange={event => setChecked(event.target.checked)} />{t('release.commit.checked')}</label>
      {changed ? <ActionNote tone="neutral">{t('release.commit.changed')} <Button disabled={busy} onClick={() => { setSnapshot(workspace); setChecked(false); }}>{t('release.wizard.recheck')}</Button></ActionNote> : null}
    </FormDialog> : null}
  </>;
}
