import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { useDateText } from '../../../../shared/lib/useDateText';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import type { ComputeProfileListItem } from '@crewstation/contracts';
import { ComputeProfileNameSchema, ComputeProfileReferencesSchema } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, isApiClientError, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { ConfirmDialog } from '../../../../shared/ui/dialog/ConfirmDialog';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { AdminField } from '../AdminField';
import styles from '../../../../shared/ui/CapabilityCatalog.module.css';

const INVALIDATE = [queryKeys.computeProfiles()];

/** 409 profile_referenced 时服务端给出引用该档位的项目清单（C19、P8）；其余错误原样显示。 */
function referencedProjects(error: unknown): string[] | undefined {
  if (!isApiClientError(error) || error.kind !== 'conflict') return undefined;
  const parsed = ComputeProfileReferencesSchema.safeParse(error.details);
  return parsed.success ? parsed.data.projects : undefined;
}

export interface ProfileRowActionsProps {
  readonly profile: ComputeProfileListItem;
  readonly updatedBy: string;
  readonly onOpen: (name: string) => void;
  /** 主行和管理弹窗共享操作状态，等待请求时禁用编辑。 */
  readonly children: (controls: ReactElement, expanded: boolean) => ReactElement;
}

/**
 * 一行的操作：编辑、复制、设为默认、启用／停用、删除。照 agent-workflow（C19）：默认档位不能停用也不能删除，
 * 通用终端档位不能设为默认（default 会被 Manifest 的业务子任务引用）；删除被已上线版本引用的档位要二次确认。
 * 删除与「仍然删除」都不可撤销，走弹窗并输入 delete（2026-09-23 作者裁定）；请求结束后弹窗关闭，结果显示在面板里。
 * 复制的新名称也在弹窗里（2026-09-23 起）：关窗与收起面板都保留输入，「清空」回到「原名-copy」，成功才丢。
 */
export function ProfileRowActions({ profile, updatedBy, onOpen, children }: ProfileRowActionsProps): ReactElement {
  const t = useT(), dateText = useDateText();
  const [expanded, setExpanded] = useState(false);
  // 没改过名称时为 undefined，默认名跟着档位当前的名字走。
  const [copying, setCopying] = useState(false), [copyName, setCopyName] = useState<string>();
  // 「仍然删除」时记下当时列出的引用项目：请求一发出错误就清空，弹窗里的清单不能跟着消失。
  const [removing, setRemoving] = useState<{ readonly references?: readonly string[] }>();
  const copy = useApiMutation((name: string) => api.computeProfiles.copy(profile.id, { name }), { invalidate: INVALIDATE, onSuccess: (detail) => { setCopying(false); setCopyName(undefined); onOpen(detail.id); } });
  const setDefault = useApiMutation(() => api.computeProfiles.setDefault(profile.id), { invalidate: INVALIDATE });
  const visibility = useApiMutation((value: boolean) => api.computeProfiles.setDefaultVisible(profile.id, value), { invalidate: INVALIDATE });
  const toggle = useApiMutation((enabled: boolean) => api.computeProfiles.setEnabled(profile.id, enabled), { invalidate: INVALIDATE });
  const remove = useApiMutation((confirmReferences: boolean) => api.computeProfiles.remove(profile.id, { confirmReferences }), { invalidate: INVALIDATE });
  const references = referencedProjects(remove.error);
  const busy = visibility.isPending || copy.isPending || setDefault.isPending || toggle.isPending || remove.isPending;
  const defaultBlocked = profile.protocol === 'terminal' ? t('admin.profile.defaultTerminal') : !profile.enabled ? t('admin.profile.defaultDisabled') : undefined;
  const copyDefault = `${profile.name}-copy`, copyValue = copyName ?? copyDefault, copyValid = ComputeProfileNameSchema.safeParse(copyValue).success;
  return (
    <>
      {children(<div className={styles.rowActions}>
        <Button size="small" disabled={busy} onClick={() => onOpen(profile.id)}>{t('admin.profile.edit')}</Button>
        <Button size="small" aria-haspopup="dialog" onClick={() => setExpanded(!expanded)}>{t('admin.profile.moreActions')}</Button>
      </div>, expanded)}
      {expanded ? <Dialog title={t('admin.profile.actionsFor', { name: profile.name })} busy={busy} onClose={() => setExpanded(false)}>
        <DefinitionList items={[
          { label: t('admin.profile.column.image'), value: <code>{profile.image}<br />{profile.imageDigest}</code> },
          { label: t('admin.profile.column.binary'), value: <code>{profile.binaryPath}</code> },
          { label: t('admin.profile.column.updated'), value: `${updatedBy} · ${dateText(profile.updatedAt)}` },
        ]} />
        <div className={styles.secondaryActions}>
        <Button disabled={busy} onClick={() => setCopying(true)}>{t('admin.profile.copy')}</Button>
        {profile.isDefault ? null : defaultBlocked ? <Button disabled title={defaultBlocked}>{t('admin.profile.setDefault')}</Button>
          : <InlineConfirm label={t('admin.profile.setDefault')} question={t('admin.profile.setDefaultQuestion', { name: profile.name })} busy={setDefault.isPending} busyLabel={t('admin.profile.working')} onConfirm={() => setDefault.mutate(undefined)} />}
        {profile.isDefault && profile.enabled ? <Button disabled title={t('admin.profile.defaultLocked')}>{t('admin.profile.disable')}</Button>
          : <InlineConfirm label={profile.enabled ? t('admin.profile.disable') : t('admin.profile.enable')} question={profile.enabled ? t('admin.profile.disableQuestion', { name: profile.name }) : t('admin.profile.enableQuestion', { name: profile.name })}
              busy={toggle.isPending} busyLabel={t('admin.profile.working')} onConfirm={() => toggle.mutate(!profile.enabled)} />}
        {profile.isDefault ? <Button disabled title={t('admin.profile.visibilityLocked')}>{t('admin.profile.defaultVisible')}</Button> : <InlineConfirm label={t(profile.defaultVisible === false ? 'admin.profile.defaultVisible' : 'admin.profile.defaultHidden')} question={t('admin.profile.visibilityQuestion', { name: profile.name })} busy={visibility.isPending} onConfirm={() => visibility.mutate(profile.defaultVisible === false)} />}
        <span className={styles.destructive}>{profile.isDefault ? <Button variant="danger" disabled title={t('admin.profile.defaultLocked')}>{t('admin.profile.remove')}</Button>
          : <Button variant="danger" disabled={busy} onClick={() => { remove.reset(); setRemoving({}); }}>{remove.isPending ? t('admin.profile.removing') : t('admin.profile.remove')}</Button>}</span>
        </div>
      {profile.isDefault ? <p className={styles.hint}>{t('admin.profile.defaultLocked')}</p> : null}
      {copying ? <FormDialog title={t('admin.profile.copyTitle', { name: profile.name })} submitLabel={t('admin.profile.copyConfirm')} busyLabel={t('admin.profile.working')} busy={copy.isPending} submitDisabled={!copyValid}
        error={copy.error ? t('admin.profile.copyError', { message: errorMessage(copy.error) }) : undefined} dirty={copyValue !== copyDefault}
        onClear={() => { setCopyName(undefined); copy.reset(); }} onClose={() => setCopying(false)} onSubmit={() => { if (copyValid && !busy) copy.mutate(copyValue); }}>
        <AdminField label={t('admin.profile.copyName')} value={copyValue} onChange={setCopyName} disabled={copy.isPending} error={copyValue !== '' && !copyValid ? t('admin.profile.error.profileName') : undefined} />
      </FormDialog> : null}
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
      </Dialog> : null}
    </>
  );
}
