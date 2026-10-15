import { useEffect, useState } from 'react';
import { ProjectCostVisibilitySchema, type ProjectCostVisibility, type ProjectDto, type SetProjectCostVisibility } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Stack } from '../../../../shared/ui/Stack';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { AdminField } from '../AdminField';

interface Props {
  project: Pick<ProjectDto, 'id' | 'name'>; open: boolean; onClose: () => void; onClear: () => void;
  onSaved: () => void; onDirtyChange: (value: boolean) => void;
}
type Setting = 'hidden' | 'visible';

/** RFC-034 v2 §3.4：项目页与项目成员是否看得到人民币估值；默认不可见，系统页始终可见，Token 用量照常展示。 */
export function ProjectCostVisibilityEditor({ project, open, onClose, onClear, onSaved, onDirtyChange }: Props) {
  const t = useT(), dateText = useDateText(), key = ['admin', 'cost-visibility', project.id];
  const read = async (): Promise<ProjectCostVisibility> => {
    const value = ProjectCostVisibilitySchema.parse(await api.observability.costVisibility(project.id));
    if (value.projectId !== project.id) throw new Error(t('admin.directory.invalid'));
    return value;
  };
  const { query } = useAdminPage(key, read, open);
  const [choice, setChoice] = useState<Setting>();
  const save = useApiMutation(async (input: SetProjectCostVisibility) => ProjectCostVisibilitySchema.parse(await api.observability.setCostVisibility(project.id, input)),
    { invalidate: [key], onSuccess: onSaved });
  const current: Setting | undefined = query.data ? (query.data.visible ? 'visible' : 'hidden') : undefined, value = choice ?? current;
  const dirty = choice !== undefined && choice !== current;
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  return <>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.pricing.visibility.title')} isNavigationBusy={() => save.isPending} />
    {open ? <FormDialog title={t('admin.pricing.visibility.editTitle', { name: project.name })} submitLabel={t('admin.pricing.visibility.save')}
      busy={save.isPending} submitDisabled={!value || !!query.error || !dirty} error={save.error ? errorMessage(save.error) : undefined}
      onSubmit={() => { if (value) save.mutate({ visible: value === 'visible' }); }} onClose={onClose} onClear={onClear} dirty={dirty}>
      <Stack>
        <p>{t('admin.pricing.visibility.hint')}</p>
        <QueryStatus isPending={query.isPending} error={query.error} />
        {value ? <>
          <AdminField label={t('admin.pricing.visibility.setting')} value={value} disabled={save.isPending || !!query.error}
            options={(['hidden', 'visible'] as const).map((option) => ({ value: option, label: t('admin.pricing.visibility.' + option) }))}
            onChange={(next) => setChoice(next as Setting)} />
          <p>{query.data?.updatedAt ? t('admin.pricing.visibility.updatedAt', { at: dateText(query.data.updatedAt) }) : t('admin.pricing.visibility.default')}</p>
        </> : null}
      </Stack>
    </FormDialog> : null}
  </>;
}
