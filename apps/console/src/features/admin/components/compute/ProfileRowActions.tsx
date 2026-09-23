import type { ComputeProfileListItem } from '@crewstation/contracts';
import { ComputeProfileNameSchema, ComputeProfileReferencesSchema } from '@crewstation/contracts';
import { useId, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, isApiClientError, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { ConfirmDialog } from '../../../../shared/ui/dialog/ConfirmDialog';
import { AdminField } from '../AdminField';
import styles from './ComputeList.module.css';

const INVALIDATE = [queryKeys.computeProfiles()];

/** 409 profile_referenced 时服务端给出引用该档位的项目清单（C19、P8）；其余错误原样显示。 */
function referencedProjects(error: unknown): string[] | undefined {
  if (!isApiClientError(error) || error.kind !== 'conflict') return undefined;
  const parsed = ComputeProfileReferencesSchema.safeParse(error.details);
  return parsed.success ? parsed.data.projects : undefined;
}

export interface ProfileRowActionsProps {
  readonly profile: ComputeProfileListItem;
  readonly onOpen: (name: string) => void;
  /** 主行与展开行共享操作状态，等待请求时主行仍能禁用编辑；展开内容不挤进主行的操作单元格。 */
  readonly children: (controls: ReactElement, expanded: boolean) => ReactElement;
}

/**
 * 一行的操作：编辑、复制、设为默认、启用／停用、删除。照 agent-workflow（C19）：默认档位不能停用也不能删除，
 * 通用终端档位不能设为默认（default 会被 Manifest 的业务子任务引用）；删除被已上线版本引用的档位要二次确认。
 * 删除与「仍然删除」都不可撤销，走弹窗并输入 delete（2026-09-23 作者裁定）；请求结束后弹窗关闭，结果显示在面板里。
 */
export function ProfileRowActions({ profile, onOpen, children }: ProfileRowActionsProps): ReactElement {
  const t = useT();
  const panelId = useId(), trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyName, setCopyName] = useState('');
  // 「仍然删除」时记下当时列出的引用项目：请求一发出错误就清空，弹窗里的清单不能跟着消失。
  const [removing, setRemoving] = useState<{ readonly references?: readonly string[] }>();
  const copy = useApiMutation((name: string) => api.computeProfiles.copy(profile.id, { name }), { invalidate: INVALIDATE, onSuccess: (detail) => { setCopying(false); onOpen(detail.id); } });
  const setDefault = useApiMutation(() => api.computeProfiles.setDefault(profile.id), { invalidate: INVALIDATE });
  const visibility = useApiMutation((value: boolean) => api.computeProfiles.setDefaultVisible(profile.id, value), { invalidate: INVALIDATE });
  const toggle = useApiMutation((enabled: boolean) => api.computeProfiles.setEnabled(profile.id, enabled), { invalidate: INVALIDATE });
  const remove = useApiMutation((confirmReferences: boolean) => api.computeProfiles.remove(profile.id, { confirmReferences }), { invalidate: INVALIDATE });
  const references = referencedProjects(remove.error);
  const busy = visibility.isPending || copy.isPending || setDefault.isPending || toggle.isPending || remove.isPending;
  const defaultBlocked = profile.protocol === 'terminal' ? t('admin.profile.defaultTerminal') : !profile.enabled ? t('admin.profile.defaultDisabled') : undefined;
  const copyValid = ComputeProfileNameSchema.safeParse(copyName).success;
  return (
    <>
      {children(<div className={styles.rowActions}>
        <Button disabled={busy} onClick={() => onOpen(profile.id)}>{t('admin.profile.edit')}</Button>
        <Button ref={trigger} variant="ghost" className={styles.moreButton} aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}>{t('admin.profile.moreActions')}</Button>
      </div>, expanded)}
      {expanded ? <tr className={styles.actionRow}><td colSpan={4}>
      <div id={panelId} className={styles.actionPanel} role="region" aria-label={t('admin.profile.actionsFor', { name: profile.name })}
        onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); trigger.current?.focus(); } }}>
        <div className={styles.secondaryActions}>
        <Button disabled={busy} onClick={() => { setCopying((open) => !open); setCopyName(`${profile.name}-copy`); }}>{t('admin.profile.copy')}</Button>
        {profile.isDefault ? null : defaultBlocked ? <Button disabled title={defaultBlocked}>{t('admin.profile.setDefault')}</Button>
          : <InlineConfirm label={t('admin.profile.setDefault')} question={t('admin.profile.setDefaultQuestion', { name: profile.name })} busy={setDefault.isPending} busyLabel={t('admin.profile.working')} onConfirm={() => setDefault.mutate(undefined)} />}
        {profile.isDefault && profile.enabled ? <Button disabled title={t('admin.profile.defaultLocked')}>{t('admin.profile.disable')}</Button>
          : <InlineConfirm label={profile.enabled ? t('admin.profile.disable') : t('admin.profile.enable')} question={profile.enabled ? t('admin.profile.disableQuestion', { name: profile.name }) : t('admin.profile.enableQuestion', { name: profile.name })}
              busy={toggle.isPending} busyLabel={t('admin.profile.working')} onConfirm={() => toggle.mutate(!profile.enabled)} />}
        {profile.isDefault ? <Button disabled title={t('admin.profile.visibilityLocked')}>{t('admin.profile.defaultVisible')}</Button> : <InlineConfirm label={t(profile.defaultVisible === false ? 'admin.profile.defaultVisible' : 'admin.profile.defaultHidden')} question={t('admin.profile.visibilityQuestion', { name: profile.name })} busy={visibility.isPending} onConfirm={() => visibility.mutate(profile.defaultVisible === false)} />}
        <span className={styles.destructive}>{profile.isDefault ? <Button disabled title={t('admin.profile.defaultLocked')}>{t('admin.profile.remove')}</Button>
          : <Button variant="danger" disabled={busy} onClick={() => { remove.reset(); setRemoving({}); }}>{remove.isPending ? t('admin.profile.removing') : t('admin.profile.remove')}</Button>}</span>
        </div>
      {profile.isDefault ? <p className={styles.hint}>{t('admin.profile.defaultLocked')}</p> : null}
      {copying ? (
        <form className={styles.copyForm} onSubmit={(event) => { event.preventDefault(); if (copyValid && !busy) copy.mutate(copyName); }}>
          <AdminField label={t('admin.profile.copyName')} value={copyName} onChange={setCopyName} disabled={copy.isPending} error={copyName !== '' && !copyValid ? t('admin.profile.error.profileName') : undefined} />
          <div className={styles.secondaryActions}>
          <Button type="submit" variant="primary" disabled={!copyValid || copy.isPending}>{copy.isPending ? t('admin.profile.working') : t('admin.profile.copyConfirm')}</Button>
          <Button variant="ghost" disabled={copy.isPending} onClick={() => setCopying(false)}>{t('admin.profile.cancel')}</Button>
          </div>
        </form>
      ) : null}
      {copy.error ? <ActionNote tone="error">{t('admin.profile.copyError', { message: errorMessage(copy.error) })}</ActionNote> : null}
      {setDefault.error ? <ActionNote tone="error">{t('admin.profile.setDefaultError', { message: errorMessage(setDefault.error) })}</ActionNote> : null}
      {visibility.error ? <ActionNote tone="error">{errorMessage(visibility.error)}</ActionNote> : null}
      {toggle.error ? <ActionNote tone="error">{t('admin.profile.toggleError', { message: errorMessage(toggle.error) })}</ActionNote> : null}
      {references ? (
        <ActionNote tone="error">
          {t('admin.profile.referencedBy', { projects: references.join('、') })}{' '}
          <Button variant="danger" disabled={busy} onClick={() => setRemoving({ references })}>{t('admin.profile.removeAnyway')}</Button>
        </ActionNote>
      ) : remove.error ? <ActionNote tone="error">{t('admin.profile.removeError', { message: errorMessage(remove.error) })}</ActionNote> : null}
      {removing ? <ConfirmDialog title={t(removing.references ? 'admin.profile.removeAnyway' : 'admin.profile.removeTitle')} confirmWord="delete"
        question={removing.references ? t('admin.profile.removeAnywayQuestion', { name: profile.name, count: removing.references.length }) : t('admin.profile.removeQuestion', { name: profile.name })}
        confirmLabel={t(removing.references ? 'admin.profile.removeAnyway' : 'admin.profile.removeConfirm')} busy={remove.isPending} busyLabel={t('admin.profile.removing')}
        onConfirm={() => remove.mutate(!!removing.references, { onSettled: () => setRemoving(undefined) })} onCancel={() => setRemoving(undefined)}>
        <p>{removing.references ? t('admin.profile.referencedBy', { projects: removing.references.join('、') }) : t('admin.profile.removeHint')}</p>
      </ConfirmDialog> : null}
      </div></td></tr> : null}
    </>
  );
}
