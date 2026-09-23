import { useState } from 'react';
import type { ReactElement } from 'react';
import type { ProjectRateLimitsDto, SetProjectRateLimitsRequest } from '@crewstation/contracts';
import { ProjectRateLimitsDtoSchema } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { AdminField } from '../AdminField';
import type { RateLimitDraft, RateLimitErrors } from '../../model/rateLimitDraft';
import { rateLimitDraft, validateRateLimits } from '../../model/rateLimitDraft';
import { RateLimitFacts, RateLimitFields } from '../settings/RateLimitParts';

type Group = 'userDomain' | 'serviceDomain';
const GROUPS: readonly Group[] = ['userDomain', 'serviceDomain'];

/** 修改中：每组「照平台默认」还是「单独设置」，单独设置的那组按生效值预填；带开始修改时的版本号。 */
interface Editing { readonly draft: RateLimitDraft; readonly own: ReadonlySet<Group>; readonly base: string; readonly revision: number }
const fresh = (limits: ProjectRateLimitsDto): Editing => {
  const own = new Set(GROUPS.filter((group) => limits.override?.[group])), draft = rateLimitDraft(limits.effective);
  return { draft, own, base: JSON.stringify([draft, [...own]]), revision: limits.revision };
};
const changed = (editing: Editing | undefined) => !!editing && JSON.stringify([editing.draft, [...editing.own]]) !== editing.base;

/**
 * 项目的限流（RFC-025 T10，设计 §7.3）：用户域与服务域默认照平台设置，管理员可以为这个项目单独设置其中一组或两组，也可以撤销。
 * 保存后几秒内由调和器改写这个项目命名空间里的限流中间件。
 */
export function ProjectRateLimitCard({ projectId }: { readonly projectId: string }): ReactElement {
  const t = useT();
  // 回执先按契约解析：形状不对就是读取失败，不拿半截数据渲染。
  const limits = useApiQuery(queryKeys.projectRateLimits(projectId), async () => ProjectRateLimitsDtoSchema.parse(await api.platformSettings.projectRateLimits(projectId)));
  const [editing, setEditing] = useState<Editing>(), [open, setOpen] = useState(false), [errors, setErrors] = useState<RateLimitErrors>({}), [done, setDone] = useState<string>();
  const save = useApiMutation((input: SetProjectRateLimitsRequest) => api.platformSettings.setProjectRateLimits(projectId, input), {
    invalidate: [queryKeys.projectRateLimits(projectId)],
    onSuccess: (result) => { setEditing(undefined); setOpen(false); setDone(t(result.override ? 'admin.resources.rateLimits.saved' : 'admin.resources.rateLimits.revoked')); },
  });
  const current = limits.data && !limits.error ? limits.data : undefined, dirty = changed(editing);
  const start = () => { if (!current) return; setEditing(fresh(current)); setErrors({}); save.reset(); };
  const edit = () => { setDone(undefined); if (!dirty) start(); setOpen(true); };
  const submit = () => {
    if (!editing) return;
    const groups = GROUPS.filter((group) => editing.own.has(group));
    const result = validateRateLimits(editing.draft, groups); setErrors(result.errors);
    if (result.limits) save.mutate({ override: groups.length ? result.limits : null, expectedRevision: editing.revision });
  };
  const change = (key: string, value: string) => { setEditing((previous) => (previous ? { ...previous, draft: { ...previous.draft, [key]: value } } : previous)); setErrors((previous) => { const { [key]: _removed, ...rest } = previous; return rest; }); };
  const choose = (group: Group, own: boolean) => setEditing((previous) => {
    if (!previous) return previous;
    const next = new Set(previous.own);
    if (own) next.add(group); else next.delete(group);
    return { ...previous, own: next };
  });
  return <Card title={t('admin.resources.rateLimits.title')} actions={current ? <Button onClick={edit}>{t('admin.resources.rateLimits.edit')}</Button> : undefined}>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.resources.rateLimits.title')} isNavigationBusy={() => save.isPending} />
    <p>{t('admin.resources.rateLimits.description')}</p>
    <QueryStatus isPending={limits.isPending} error={limits.error} />
    {current ? GROUPS.map((group) => <RateLimitFacts key={group} group={group} limits={current.effective[group]} tag={t(current.override?.[group] ? 'admin.resources.rateLimits.source.override' : 'admin.resources.rateLimits.source.default')} />) : null}
    {current?.override ? <ActionRow>
      <InlineConfirm variant="ghost" label={t('admin.resources.rateLimits.revoke')} question={t('admin.resources.rateLimits.revokeQuestion')} busy={save.isPending}
        onConfirm={() => { setDone(undefined); save.mutate({ override: null, expectedRevision: current.revision }); }} />
    </ActionRow> : null}
    {done ? <ActionNote tone="success">{done}</ActionNote> : null}
    {save.error && !open ? <ActionNote tone="error">{errorMessage(save.error)}</ActionNote> : null}
    {open && editing ? <FormDialog title={t('admin.resources.rateLimits.editTitle')} submitLabel={t('admin.settings.rateLimits.save')} busyLabel={t('admin.settings.rateLimits.saving')} busy={save.isPending}
      error={save.error ? errorMessage(save.error) : undefined} dirty={dirty} onClear={start} onClose={() => setOpen(false)} onSubmit={submit}>
      {GROUPS.map((group) => <div key={group}>
        <AdminField label={t(`admin.settings.rateLimits.group.${group}`)} value={editing.own.has(group) ? 'override' : 'default'} disabled={save.isPending}
          options={[{ value: 'default', label: t('admin.resources.rateLimits.mode.default') }, { value: 'override', label: t('admin.resources.rateLimits.mode.override') }]} onChange={(value) => choose(group, value === 'override')} />
        {editing.own.has(group) ? <RateLimitFields group={group} draft={editing.draft} errors={errors} disabled={save.isPending} onChange={change} /> : null}
      </div>)}
    </FormDialog> : null}
  </Card>;
}
