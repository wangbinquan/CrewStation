import type { ConfigEnv, ConfigItemDto } from '@crewstation/contracts';
import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { errorMessage, isApiClientError, useApiQuery } from '../../../shared/api/useApi';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ConfirmationDialog } from '../../../shared/ui/dialog/ConfirmationDialog';
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

/**
 * 写入入口按当前身份和取值组展示；身份重读失败时保留草稿并停写。列表卡片：「新增变量」在卡片头右侧，行内动作在行末。
 * 新增与修改在弹窗里（2026-09-23 起），草稿关窗保留；改编辑另一项前先确认。
 */
export function ConfigEnvPanel({ projectId, env, onDirtyChange }: ConfigEnvPanelProps): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get());
  const role = me.data?.memberships?.find((member) => member.projectId === projectId)?.role;
  const editable = me.data?.isAdmin === true || role === 'owner' || env === 'development' && role === 'developer';
  const { definitions, items, versions, save, remove } = useConfigEnv(projectId, env);
  const editor = useConfigDraft(env, onDirtyChange), envLabel = t(`config.env.${env}`);
  // 保存失败的原因只属于发出那次保存的草稿：换了草稿（sequence 变了）就不再显示。
  const writeLock = useRef(false), [savedFor, setSavedFor] = useState<number>();
  const list = items.data?.items ?? [];
  // 例行重读（取值与身份都会定时重读）不算停写，否则按钮每 30 秒变灰一次；首次读取或读取失败才停写。
  const busy = save.isPending || remove.isPending, disabled = items.isPending || !!items.error || me.isPending || !!me.error || !editable;
  const changeItem = async (input: Parameters<typeof save.mutateAsync>[0]) => {
    if (writeLock.current || disabled) throw new Error('当前无法保存配置');
    writeLock.current = true; setSavedFor(editor.sequence);
    try { const result = await save.mutateAsync(input); editor.complete(); return result; } finally { writeLock.current = false; }
  };
  const deleteItem = async (item: ConfigItemDto) => {
    if (writeLock.current || disabled) return;
    writeLock.current = true;
    try { await remove.mutateAsync({ id: item.id, version: item.version, name: item.name }); } catch { /* 错误由面板显示。 */ } finally { writeLock.current = false; }
  };
  return (
    <Card stacked compact
      title={t(`config.variables.${env}`)}
      extra={<><Badge tone={env === 'production' ? 'warning' : 'info'}>{t(`config.env.${env}Role`)}</Badge>{editable ? <Button variant="primary" disabled={disabled || busy} onClick={() => editor.select({ name: '', isSecret: false })}>{t('config.add')}</Button> : null}</>}
      footer={
        <Stack>
          <h3 className={styles.versionsTitle}>{t('config.versions.title')}</h3>
          <p className={styles.versionsNote}>{t('config.versions.note')}</p>
          <QueryStatus isPending={versions.isPending} error={versions.error} errorKey="config.error.versions" />
          {!versions.error ? <ConfigVersionList versions={versions.data?.items ?? []} pending={versions.isPending} /> : null}
        </Stack>
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
          onEdit={(item) => {
            editor.select({ id: item.id, definitionId: item.definitionId, bindingName: item.bindingName, expectedVersion: item.version, name: item.name, isSecret: item.isSecret, ...(item.isSecret ? {} : { value: item.value ?? '' }) });
          }}
        />
      ) : null}
      <WriteError action="config.error.delete" error={remove.error} />
      {save.isSuccess ? <ActionNote tone="success">{t('config.saved', { name: save.data.name, version: save.data.version, env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      {remove.isSuccess ? <ActionNote tone="success">{t('config.deleted', { name: remove.variables?.name ?? '', env: t(`config.env.${env}`) })} {t(`config.effect.${env}`)}</ActionNote> : null}
      {editor.next ? <ConfirmationDialog question={t('config.draft.replace', { env: envLabel, name: editor.next.name || t('config.draft.blank') })} confirmLabel={t('config.draft.discard')} cancelLabel={t('ui.draft.stay')} focus="cancel" busy={busy} onConfirm={editor.confirm} onCancel={editor.keep} /> : null}
      {editor.draft ? <ConfigItemForm key={editor.sequence} open={editor.open} draft={editor.draft} envLabel={envLabel} definitions={definitions.data?.items ?? []} existingNames={list.map((item) => item.bindingName)} pending={save.isPending} disabled={disabled || remove.isPending}
        error={savedFor === editor.sequence ? writeErrorText(t, 'config.error.save', save.error) : undefined} onSubmit={changeItem} onDirtyChange={editor.dirtyChanged} onClose={editor.hide} onClear={editor.clear} /> : null}
    </Card>
  );
}

/** 请求在途时权限仍可能变化，保留服务端拒绝与原始错误说明。 */
function writeErrorText(t: ReturnType<typeof useT>, action: string, error: unknown): string | undefined {
  if (error === null || error === undefined) return undefined;
  const forbidden = isApiClientError(error) && error.status === 403;
  return `${t(action, { message: errorMessage(error) })}${forbidden ? ` ${t('config.error.forbidden')}` : ''}`;
}

function WriteError({ action, error }: { readonly action: string; readonly error: unknown }): ReactElement | null {
  const t = useT(), text = writeErrorText(t, action, error);
  return text === undefined ? null : <ActionNote tone="error">{text}</ActionNote>;
}
