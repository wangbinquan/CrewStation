import type { ConfigEnv } from '@crewstation/contracts';
import { useCallback, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage, isApiClientError } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useConfigEnv } from '../hooks/useConfigEnv';
import { ConfigItemForm } from './ConfigItemForm';
import type { ConfigItemDraft } from './ConfigItemForm';
import { ConfigItemTable } from './ConfigItemTable';
import { ConfigVersionList } from './ConfigVersionList';
import styles from './ConfigEnvPanel.module.css';

const NEW_ITEM: ConfigItemDraft = { name: '', isSecret: false };

export interface ConfigEnvPanelProps {
  readonly projectId: string;
  readonly env: ConfigEnv;
  readonly onDirtyChange: (env: ConfigEnv, dirty: boolean) => void;
}

/** 一组取值的完整面板：列表、新增／覆盖表单、版本历史。生产组的 403 由服务端说明原样呈现。 */
export function ConfigEnvPanel({ projectId, env, onDirtyChange }: ConfigEnvPanelProps): ReactElement {
  const t = useT();
  const { items, versions, save, remove } = useConfigEnv(projectId, env);
  const [draft, setDraft] = useState<ConfigItemDraft>(NEW_ITEM);
  const [draftSeq, setDraftSeq] = useState(0);
  const [dirty, setDirty] = useState(false), [nextDraft, setNextDraft] = useState<ConfigItemDraft>();
  const dirtyChanged = useCallback((value: boolean) => { setDirty(value); onDirtyChange(env, value); }, [env, onDirtyChange]);
  const replaceDraft = (next: ConfigItemDraft) => { setDraft(next); setDraftSeq((seq) => seq + 1); setNextDraft(undefined); };
  const selectDraft = (next: ConfigItemDraft) => { if (dirty) setNextDraft(next); else replaceDraft(next); };
  const writeLock = useRef(false);
  const list = items.data?.items ?? [];
  const busy = save.isPending || remove.isPending, disabled = items.isPending || !!items.error;
  const changeItem = async (input: Parameters<typeof save.mutateAsync>[0]) => {
    if (writeLock.current || disabled) throw new Error('当前无法保存配置');
    writeLock.current = true;
    try { return await save.mutateAsync(input); } finally { writeLock.current = false; }
  };
  const deleteItem = async (name: string) => {
    if (writeLock.current || disabled) return;
    writeLock.current = true;
    try { await remove.mutateAsync(name); } catch { /* 错误由面板显示。 */ } finally { writeLock.current = false; }
  };
  return (
    <Card
      title={t(`config.env.${env}`)}
      extra={<><Badge tone={env === 'production' ? 'warning' : 'info'}>{t(`config.env.${env}Role`)}</Badge><Button disabled={busy || items.isFetching || versions.isFetching} onClick={() => { void items.refetch(); void versions.refetch(); }}>{t('config.refresh')}</Button></>}
      footer={
        <>
          <h3 className={styles.versionsTitle}>{t('config.versions.title')}</h3>
          <p className={styles.versionsNote}>{t('config.versions.note')}</p>
          <QueryStatus isPending={versions.isPending} error={versions.error} errorKey="config.error.versions" />
          {!versions.error ? <ConfigVersionList versions={versions.data?.items ?? []} pending={versions.isPending} /> : null}
        </>
      }
    >
      <p className={styles.note}>{t(`config.env.${env}Note`)}</p>
      <QueryStatus
        isPending={items.isPending}
        error={items.error}
        loadingKey="config.items.loading"
        errorKey="config.error.load"
        isEmpty={list.length === 0}
        emptyTitle={t('config.items.emptyTitle')}
        emptyDescription={t('config.items.emptyDescription')}
      />
      {list.length > 0 ? (
        <ConfigItemTable
          items={list}
          disabled={disabled || busy}
          deletingName={remove.isPending ? remove.variables : undefined}
          onDelete={(name) => void deleteItem(name)}
          onEdit={(item) => {
            selectDraft({ name: item.name, isSecret: item.isSecret, ...(item.isSecret ? {} : { value: item.value ?? '' }) });
          }}
        />
      ) : null}
      <WriteError action="config.error.save" error={save.error} />
      <WriteError action="config.error.delete" error={remove.error} />
      {save.isSuccess ? <ActionNote tone="success">{t('config.saved', { name: save.data.name, version: save.data.version, env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      {remove.isSuccess ? <ActionNote tone="success">{t('config.deleted', { name: remove.variables ?? '', env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      <h3 className={styles.formTitle}>{t('config.form.title')}</h3>
      {nextDraft ? <ConfirmationPanel question={t('config.draft.replace', { env: t(`config.env.${env}`), name: nextDraft.name || t('config.draft.blank') })} confirmLabel={t('config.draft.discard')} cancelLabel={t('ui.draft.stay')} busy={busy} onConfirm={() => replaceDraft(nextDraft)} onCancel={() => setNextDraft(undefined)} /> : null}
      <ConfigItemForm key={`${draft.name}:${draftSeq}`} draft={draft} existingNames={list.map((item) => item.name)} pending={save.isPending} disabled={disabled || remove.isPending || Boolean(nextDraft)} onSubmit={changeItem} onReset={() => selectDraft(NEW_ITEM)} onDirtyChange={dirtyChanged} />
    </Card>
  );
}

/** 写失败的说明；403 另加一句“生产组由负责人维护”，控件保持可见而不是被藏起来。 */
function WriteError({ action, error }: { readonly action: string; readonly error: unknown }): ReactElement | null {
  const t = useT();
  if (error === null || error === undefined) return null;
  const forbidden = isApiClientError(error) && error.status === 403;
  return (
    <ActionNote tone="error">
      {t(action, { message: errorMessage(error) })}
      {forbidden ? ` ${t('config.error.forbidden')}` : ''}
    </ActionNote>
  );
}
