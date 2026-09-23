import { useState } from 'react';
import type { ReactElement } from 'react';
import type { AutoOfflinePolicyDto, SetAutoOfflinePolicyRequest } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { AdminField } from '../AdminField';
import { AdminForm } from '../AdminForm';
import { AUTO_OFFLINE_FIELDS, autoOfflineDraft, validateAutoOffline } from '../../model/autoOfflineDraft';
import type { AutoOfflineDraft, AutoOfflineErrors } from '../../model/autoOfflineDraft';

/** 修改中：开始修改时读到的版本号跟着草稿走，之后的重读不改变这次确认；别人先保存过时服务端 409。 */
interface Editing { readonly draft: AutoOfflineDraft; readonly revision: number }

/**
 * 待验证版本自动下线的三个时长（RFC-021 M11、M12、M22、M28）：平台统一，保存后立即作用于所有项目的到期时间。
 * 调短不会让已过期的版本立刻消失：平台先提醒负责人，提醒满提前量之后才下线。
 */
export function AutoOfflineSettingsCard(): ReactElement {
  const t = useT(), date = useDateText();
  const policy = useApiQuery(queryKeys.autoOfflinePolicy(), () => api.platformSettings.autoOffline());
  const [editing, setEditing] = useState<Editing>(), [errors, setErrors] = useState<AutoOfflineErrors>({}), [done, setDone] = useState<string>();
  const save = useApiMutation((input: SetAutoOfflinePolicyRequest) => api.platformSettings.setAutoOffline(input), { invalidate: [queryKeys.autoOfflinePolicy()], onSuccess: () => { setEditing(undefined); setDone(t('admin.settings.autoOffline.saved')); } });
  const current = policy.data && !policy.error ? policy.data : undefined;
  const submit = () => {
    if (!editing) return;
    const result = validateAutoOffline(editing.draft, editing.revision); setErrors(result.errors);
    if (result.request) save.mutate(result.request);
  };
  const field = (name: (typeof AUTO_OFFLINE_FIELDS)[number]) => <AdminField key={name} label={t(`admin.settings.autoOffline.${name}`)} hint={t(`admin.settings.autoOffline.hint.${name}`)} inputMode="numeric"
    value={editing?.draft[name] ?? ''} disabled={save.isPending} {...(errors[name] ? { error: t(errors[name]!) } : {})}
    onChange={(value) => { setEditing((previous) => (previous ? { ...previous, draft: { ...previous.draft, [name]: value } } : previous)); setErrors((previous) => ({ ...previous, [name]: undefined })); }} />;
  return <Card title={t('admin.settings.autoOffline.title')} extra={current && !editing ? <Button onClick={() => { setDone(undefined); save.reset(); setErrors({}); setEditing({ draft: autoOfflineDraft(current), revision: current.revision }); }}>{t('admin.settings.autoOffline.edit')}</Button> : undefined}>
    <p>{t('admin.settings.autoOffline.description')}</p>
    <QueryStatus isPending={policy.isPending} error={policy.error} />
    {current && !editing ? <PolicyFacts policy={current} date={date} /> : null}
    {editing ? <AdminForm submitLabel={t('admin.settings.autoOffline.save')} busyLabel={t('admin.settings.autoOffline.saving')} busy={save.isPending} incomplete={false}
      note={t('admin.settings.autoOffline.note')} {...(save.error ? { error: errorMessage(save.error) } : {})} onSubmit={submit}
      extraActions={<Button disabled={save.isPending} onClick={() => { setEditing(undefined); setErrors({}); save.reset(); }}>{t('admin.settings.autoOffline.cancel')}</Button>}>
      {AUTO_OFFLINE_FIELDS.map(field)}
    </AdminForm> : null}
    {done ? <ActionNote tone="success">{done}</ActionNote> : null}
  </Card>;
}

function PolicyFacts({ policy, date }: { readonly policy: AutoOfflinePolicyDto; readonly date: (value: string | undefined) => string }): ReactElement {
  const t = useT();
  return <>
    <DefinitionList items={[
      { label: t('admin.settings.autoOffline.rollbackRetentionHours'), value: t('admin.settings.autoOffline.hours', { count: policy.rollbackRetentionHours }) },
      { label: t('admin.settings.autoOffline.idleOfflineDays'), value: t('admin.settings.autoOffline.days', { count: policy.idleOfflineDays }) },
      { label: t('admin.settings.autoOffline.reminderLeadHours'), value: t('admin.settings.autoOffline.hours', { count: policy.reminderLeadHours }) },
    ]} />
    <p>{policy.revision === 0 || !policy.updatedAt ? t('admin.settings.autoOffline.defaults') : t('admin.settings.autoOffline.updatedAt', { time: date(policy.updatedAt) })}</p>
  </>;
}
