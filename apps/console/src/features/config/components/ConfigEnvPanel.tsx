import type { ConfigEnv, ConfigItemDto } from '@crewstation/contracts';
import { useRef } from 'react';
import type { ReactElement } from 'react';
import { errorMessage, isApiClientError, useApiQuery } from '../../../shared/api/useApi';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { ConfirmationPanel } from '../../../shared/ui/ConfirmationPanel';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useConfigEnv } from '../hooks/useConfigEnv';
import { ConfigItemForm } from './ConfigItemForm';
import { useConfigDraft } from '../hooks/useConfigDraft';
import { Stack } from '../../../shared/ui/Stack';
import { ConfigItemTable } from './ConfigItemTable';
import { ConfigVersionList } from './ConfigVersionList';
import styles from './ConfigEnvPanel.module.css';

export interface ConfigEnvPanelProps {
  readonly projectId: string;
  readonly env: ConfigEnv;
  readonly onDirtyChange: (env: ConfigEnv, dirty: boolean) => void;
}

/** 写入入口按当前身份和取值组展示；身份重读失败时保留草稿并停写。 */
export function ConfigEnvPanel({ projectId, env, onDirtyChange }: ConfigEnvPanelProps): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const role = me.data?.memberships?.find((member) => member.projectId === projectId)?.role;
  const editable = me.data?.isAdmin === true || role === 'owner' || env === 'development' && role === 'developer';
  const { definitions, items, versions, save, remove } = useConfigEnv(projectId, env);
  const { confirmation, ...editor } = useConfigDraft(env, onDirtyChange);
  const writeLock = useRef(false);
  const list = items.data?.items ?? [];
  const busy = save.isPending || remove.isPending, disabled = items.isPending || !!items.error || me.isPending || me.isFetching || !!me.error || !editable;
  const changeItem = async (input: Parameters<typeof save.mutateAsync>[0]) => {
    if (writeLock.current || disabled) throw new Error('当前无法保存配置');
    writeLock.current = true;
    try { const result = await save.mutateAsync(input); editor.complete(); return result; } finally { writeLock.current = false; }
  };
  const deleteItem = async (item: ConfigItemDto) => {
    if (writeLock.current || disabled) return;
    writeLock.current = true;
    try { await remove.mutateAsync({ id: item.id, version: item.version }); } catch { /* 错误由面板显示。 */ } finally { writeLock.current = false; }
  };
  return (
    <Card stacked compact
      title={t(`config.variables.${env}`)}
      extra={<>{editable ? <Button variant="primary" disabled={disabled || busy} onClick={(event) => editor.select({ name: '', isSecret: false }, event.currentTarget)}>{t('config.add')}</Button> : null}<Badge tone={env === 'production' ? 'warning' : 'info'}>{t(`config.env.${env}Role`)}</Badge><Button disabled={busy || me.isFetching || items.isFetching || versions.isFetching} onClick={() => { void me.refetch(); void items.refetch(); void versions.refetch(); }}>{t('config.refresh')}</Button></>}
      footer={
        <details><summary>{t('config.versions.title')}</summary><Stack>
          <p className={styles.versionsNote}>{t('config.versions.note')}</p>
          <QueryStatus isPending={versions.isPending} error={versions.error} errorKey="config.error.versions" />
          {!versions.error ? <ConfigVersionList versions={versions.data?.items ?? []} pending={versions.isPending} /> : null}
        </Stack></details>
      }
    >
      <p className={styles.note}>{t(`config.env.${env}Note`)}</p>
      <QueryStatus isPending={me.isPending} error={me.error} />
      {!editable && !me.isPending && !me.error ? <ActionNote tone="neutral">{t(`config.readOnly.${env}`)}</ActionNote> : null}
      <QueryStatus
        isPending={items.isPending}
        error={items.error}
        loadingKey="config.items.loading"
        errorKey="config.error.load"
        isEmpty={list.length === 0}
        emptyTitle={t('config.items.emptyTitle')}
        emptyDescription={editable ? t('config.items.emptyDescription') : t(`config.readOnly.${env}`)}
      />
      {list.length > 0 ? (
        <ConfigItemTable
          items={list}
          readOnly={!editable}
          disabled={disabled || busy}
          deletingName={remove.isPending ? remove.variables.id : undefined}
          onDelete={(name) => void deleteItem(name)}
          onEdit={(item, button) => {
            editor.select({ id: item.id, definitionId: item.definitionId, bindingName: item.bindingName, expectedVersion: item.version, name: item.name, isSecret: item.isSecret, ...(item.isSecret ? {} : { value: item.value ?? '' }) }, button);
          }}
        />
      ) : null}
      <WriteError action="config.error.save" error={save.error} />
      <WriteError action="config.error.delete" error={remove.error} />
      {save.isSuccess ? <ActionNote tone="success">{t('config.saved', { name: save.data.name, version: save.data.version, env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      {remove.isSuccess ? <ActionNote tone="success">{t('config.deleted', { name: list.find((item) => item.id === remove.variables?.id)?.name ?? remove.variables?.id ?? '', env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      {editor.next ? <div ref={confirmation}><ConfirmationPanel question={t(editor.next.draft ? 'config.draft.replace' : 'config.draft.cancel', { env: t(`config.env.${env}`), name: editor.next.draft?.name || t('config.draft.blank') })} confirmLabel={t(editor.next.draft ? 'config.draft.discard' : 'config.draft.confirmCancel')} cancelLabel={t('ui.draft.stay')} busy={busy} onConfirm={editor.confirm} onCancel={editor.keep} /></div> : null}
      {editor.draft ? <Stack>
        <h3 className={styles.formTitle}>{t(editor.draft.name ? 'config.edit' : 'config.add', { name: editor.draft.name })}</h3>
        <p className={styles.note}>{t('config.draft.lifetime')}</p>
        <ConfigItemForm key={editor.sequence} draft={editor.draft} envLabel={t(`config.env.${env}`)} definitions={definitions.data?.items ?? []} existingNames={list.map((item) => item.bindingName)} pending={save.isPending} disabled={disabled || remove.isPending || Boolean(editor.next)} onSubmit={changeItem} onReset={() => editor.select()} onDirtyChange={editor.dirtyChanged} />
      </Stack> : null}
    </Card>
  );
}

/** 请求在途时权限仍可能变化，保留服务端拒绝与原始错误说明。 */
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
