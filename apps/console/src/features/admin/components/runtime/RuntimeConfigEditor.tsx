import type { SaveRuntimeDraftInput } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import type { RuntimeConfigDetailDto } from '@crewstation/contracts';
import { BEFORE_START_LIMITS } from '@crewstation/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { useRuntimeDraft } from '../../hooks/useRuntimeDraft';
import { toSaveRequest } from '../../model/runtimeDraft';
import { AdminField } from '../AdminField';
import { RuntimeBindingEditor } from './RuntimeBindingEditor';
import { RuntimeCheckPanel } from './RuntimeCheckPanel';
import styles from './RuntimeEditor.module.css';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { RuntimeStepEditor } from './RuntimeStepEditor';
import { RuntimeStepList } from './RuntimeStepList';
import { RuntimeVariablesEditor } from './RuntimeVariablesEditor';

export interface RuntimeConfigEditorProps {
  readonly configId: string;
  readonly onClose: () => void;
}

/** 载入详情后才建草稿；详情读取失败或 404 时只显示状态与返回按钮。 */
export function RuntimeConfigEditor({ configId, onClose }: RuntimeConfigEditorProps): ReactElement {
  const t = useT();
  const query = useApiQuery(queryKeys.runtimeConfig(configId), () => api.agentRuntime.getConfig(configId));
  if (!query.data) {
    return (
      <Card title={t('admin.runtime.title')} extra={<Button onClick={onClose}>{t('admin.runtime.close')}</Button>}>
        <QueryStatus isPending={query.isPending} error={query.error} />
      </Card>
    );
  }
  return <RuntimeConfigEditorBody key={query.data.id} initial={query.data} onClose={onClose} />;
}

function RuntimeConfigEditorBody({ initial, onClose }: { readonly initial: RuntimeConfigDetailDto; readonly onClose: () => void }): ReactElement {
  const t = useT(), queryClient = useQueryClient();
  const [detail, setDetail] = useState(initial);
  const editor = useRuntimeDraft(detail);
  const [conflict, setConflict] = useState<number | undefined>(undefined);
  const [savedRevision, setSavedRevision] = useState<number | undefined>(undefined);
  const adopt = (next: RuntimeConfigDetailDto) => { setDetail(next); queryClient.setQueryData(queryKeys.runtimeConfig(next.id), next); };
  const save = useApiMutation((input: SaveRuntimeDraftInput) => api.agentRuntime.saveDraft(detail.id, input), {
    invalidate: [queryKeys.runtimeConfigs()],
    onSuccess: (next) => { adopt(next); editor.reload(next); setSavedRevision(next.draftRevision); setConflict(undefined); },
  });
  const reload = useApiMutation(() => api.agentRuntime.getConfig(detail.id), { onSuccess: (next) => { adopt(next); editor.reload(next); setConflict(undefined); } });
  const submit = () => {
    setSavedRevision(undefined);
    if (!editor.validate()) return;
    save.mutateAsync(toSaveRequest(editor.draft, editor.baseRevision)).catch((error: unknown) => {
      if (isApiClientError(error) && error.kind === 'conflict' && typeof error.details.currentRevision === 'number') setConflict(error.details.currentRevision);
    });
  };
  const busy = save.isPending || reload.isPending;
  const selected = editor.selected !== null ? editor.draft.steps[editor.selected] : undefined;
  return (
    <Card compact title={<span className={styles.toolbar}><code>{detail.name}</code> <RuntimeStatusBadge status={detail.status} /></span>} extra={<Button onClick={onClose}>{t('admin.runtime.close')}</Button>} footer={t('admin.runtime.hint')}>
      <UnsavedChangesGuard dirty={editor.dirty || busy} scope={t('admin.runtime.title')} />
      <div className={styles.sub}>
        <h3>{t('admin.runtime.section.basics')}</h3>
        <div className={styles.fields}>
          <AdminField label={t('admin.runtime.driver')} value={detail.driver} onChange={() => undefined} disabled hint={t('admin.runtime.driverFixed')} />
          <AdminField label={t('admin.runtime.description')} value={editor.draft.description} onChange={(description) => editor.update((d) => ({ ...d, description }))} disabled={busy} />
        </div>
      </div>
      <div className={styles.sub}>
        <h3>{t('admin.runtime.section.steps')}</h3>
        <p className={styles.hint}>{t('admin.runtime.stepsHint', { max: BEFORE_START_LIMITS.maxSteps })}</p>
        <div className={styles.layout}>
          <RuntimeStepList steps={editor.draft.steps} selected={editor.selected} errors={editor.errors} disabled={busy} onSelect={editor.setSelected} onAdd={editor.addStep} onMove={editor.moveStep} onDuplicate={editor.duplicateStep} onRemove={editor.removeStep} />
          {selected !== undefined && editor.selected !== null ? <RuntimeStepEditor step={selected} index={editor.selected} errors={editor.errors} disabled={busy} onChange={(patch) => editor.changeStep(editor.selected!, patch)} /> : null}
        </div>
      </div>
      <RuntimeVariablesEditor draft={editor.draft} errors={editor.errors} credentials={detail.credentials} disabled={busy} onChange={editor.update} />
      <RuntimeBindingEditor driver={detail.driver} draft={editor.draft} errors={editor.errors} disabled={busy} onChange={editor.update} />
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={busy || !editor.dirty} onClick={submit}>{save.isPending ? t('admin.runtime.saving') : t('admin.runtime.save')}</Button>
        {editor.dirty ? <Badge tone="warning">{t('admin.runtime.dirty')}</Badge> : null}
        {Object.keys(editor.errors).length > 0 ? <Badge tone="danger">{Object.keys(editor.errors).length}</Badge> : null}
      </div>
      {savedRevision !== undefined ? <ActionNote tone="success">{t('admin.runtime.saved', { revision: savedRevision, active: detail.activeRevision ?? t('admin.runtime.none') })}</ActionNote> : null}
      {conflict !== undefined ? (
        <ActionNote tone="error">
          {t('admin.runtime.conflict', { revision: conflict })}{' '}
          <Button onClick={() => { editor.adoptRevision(conflict); setConflict(undefined); }}>{t('admin.runtime.adoptConflict', { revision: conflict })}</Button>{' '}
          <Button onClick={() => reload.mutate()}>{t('admin.runtime.discard')}</Button>
        </ActionNote>
      ) : save.error ? <ActionNote tone="error">{t('admin.runtime.saveError', { message: errorMessage(save.error) })}</ActionNote> : null}
      <RuntimeCheckPanel detail={detail} dirty={editor.dirty} onChanged={adopt} onLocate={(stepId) => { const index = editor.draft.steps.findIndex((step) => step.stepId === stepId); if (index >= 0) editor.setSelected(index); }} />
    </Card>
  );
}
