import { useState } from 'react';
import type { ReactElement } from 'react';
import type { RateLimitSettingsDto, SetRateLimitSettingsRequest } from '@crewstation/contracts';
import { RateLimitSettingsDtoSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import type { RateLimitDraft, RateLimitErrors, RateLimitGroup } from '../../model/rateLimitDraft';
import { rateLimitDraft, validateRateLimits } from '../../model/rateLimitDraft';
import { RateLimitFacts, RateLimitFields } from './RateLimitParts';

const GROUPS: readonly RateLimitGroup[] = ['platformApi', 'userDomain', 'serviceDomain'];

/** 修改中：开始修改时读到的版本号跟着草稿走；别人先保存过时服务端 409。`base` 是开始修改时的值。 */
interface Editing { readonly draft: RateLimitDraft; readonly base: RateLimitDraft; readonly revision: number }
const fresh = (settings: RateLimitSettingsDto): Editing => { const base = rateLimitDraft(settings); return { draft: base, base, revision: settings.revision }; };
const changed = (editing: Editing | undefined) => !!editing && Object.keys(editing.base).some((key) => editing.draft[key] !== editing.base[key]);

/**
 * 网关限流的平台默认（RFC-025 T10，设计 §7.3）：平台接口、用户域、服务域三组；保存后几秒内由调和器改写网关的中间件。
 * 修改在弹窗里，取消只关窗、改过的输入再点「修改」恢复，「清空」回到此刻的值；改过的草稿进离开确认（与自动下线卡同一套）。
 */
export function RateLimitSettingsCard(): ReactElement {
  const t = useT(), date = useDateText();
  // 回执先按契约解析：形状不对就是读取失败，不拿半截数据渲染。
  const settings = useApiQuery(queryKeys.rateLimits(), async () => RateLimitSettingsDtoSchema.parse(await api.platformSettings.rateLimits()));
  const [editing, setEditing] = useState<Editing>(), [open, setOpen] = useState(false), [errors, setErrors] = useState<RateLimitErrors>({}), [done, setDone] = useState<string>();
  const save = useApiMutation((input: SetRateLimitSettingsRequest) => api.platformSettings.setRateLimits(input), { invalidate: [queryKeys.rateLimits()], onSuccess: () => { setEditing(undefined); setOpen(false); setDone(t('admin.settings.rateLimits.saved')); } });
  const current = settings.data && !settings.error ? settings.data : undefined, dirty = changed(editing);
  const start = () => { if (!current) return; setEditing(fresh(current)); setErrors({}); save.reset(); };
  const edit = () => { setDone(undefined); if (!dirty) start(); setOpen(true); };
  const submit = () => {
    if (!editing) return;
    const result = validateRateLimits(editing.draft, GROUPS); setErrors(result.errors);
    if (result.limits) save.mutate({ ...result.limits, expectedRevision: editing.revision });
  };
  const change = (key: string, value: string) => { setEditing((previous) => (previous ? { ...previous, draft: { ...previous.draft, [key]: value } } : previous)); setErrors((previous) => { const { [key]: _removed, ...rest } = previous; return rest; }); };
  return <Card title={t('admin.settings.rateLimits.title')} actions={current ? <Button onClick={edit}>{t('admin.settings.rateLimits.edit')}</Button> : undefined}>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.settings.rateLimits.title')} isNavigationBusy={() => save.isPending} />
    <p>{t('admin.settings.rateLimits.description')}</p>
    <QueryStatus isPending={settings.isPending} error={settings.error} />
    {current ? <>
      {GROUPS.map((group) => <RateLimitFacts key={group} group={group} limits={current[group]} />)}
      <p>{current.revision === 0 || !current.updatedAt ? t('admin.settings.rateLimits.defaults') : t('admin.settings.rateLimits.updatedAt', { time: date(current.updatedAt) })}</p>
    </> : null}
    {done ? <ActionNote tone="success">{done}</ActionNote> : null}
    {open && editing ? <FormDialog title={t('admin.settings.rateLimits.editTitle')} submitLabel={t('admin.settings.rateLimits.save')} busyLabel={t('admin.settings.rateLimits.saving')} busy={save.isPending}
      error={save.error ? errorMessage(save.error) : undefined} dirty={dirty} onClear={start} onClose={() => setOpen(false)} onSubmit={submit}>
      <p>{t('admin.settings.rateLimits.note')}</p>
      {GROUPS.map((group) => <RateLimitFields key={group} group={group} draft={editing.draft} errors={errors} disabled={save.isPending} onChange={change} />)}
    </FormDialog> : null}
  </Card>;
}
