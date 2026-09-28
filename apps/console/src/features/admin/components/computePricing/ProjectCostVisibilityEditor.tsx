import { useEffect, useRef, useState } from 'react';
import { ExecutionCostVisibilityDtoSchema, type ExecutionCostVisibility, type ExecutionCostVisibilityDto, type ProjectDto, type SetExecutionCostVisibility } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useAdminPage } from '../../../../shared/admin/useAdminRead';
import { errorMessage, useApiMutation } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { UnsavedChangesGuard } from '../../../../shared/navigation/UnsavedChangesGuard';
import { Button } from '../../../../shared/ui/Button';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Stack } from '../../../../shared/ui/Stack';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import { AdminField } from '../AdminField';

interface Props {
  project: Pick<ProjectDto, 'id' | 'name'>; open: boolean; onClose: () => void; onClear: () => void;
  onSaved: () => void; onDirtyChange: (value: boolean) => void;
}
export function ProjectCostVisibilityEditor({ project, open, onClose, onClear, onSaved, onDirtyChange }: Props) {
  const t = useT(), key = ['admin', 'cost-visibility', project.id];
  const read = async () => {
    const value = ExecutionCostVisibilityDtoSchema.parse(await api.observability.executionCostVisibility(project.id));
    if (value.projectId !== project.id) throw new Error(t('admin.directory.invalid'));
    return value;
  };
  const { query } = useAdminPage(key, read, open);
  const [edit, setEdit] = useState<{ base: ExecutionCostVisibilityDto; visibility: ExecutionCostVisibility }>();
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [latest, setLatest] = useState<ExecutionCostVisibilityDto>(), [readError, setReadError] = useState<string>();
  const [comparing, setComparing] = useState(false), receipt = useRef<{ signature: string; input: SetExecutionCostVisibility }>(undefined);
  const save = useApiMutation(async (input: SetExecutionCostVisibility) => {
    const value = ExecutionCostVisibilityDtoSchema.parse(await api.observability.setExecutionCostVisibility(project.id, input));
    if (value.projectId !== project.id) throw new Error(t('admin.directory.invalid'));
    return value;
  }, { invalidate: [key], onSuccess: () => { setUnconfirmed(false); onSaved(); } });
  const base = edit?.base ?? query.data, value = edit?.visibility ?? base?.visibility;
  const dirty = unconfirmed || !!edit && edit.visibility !== edit.base.visibility;
  useEffect(() => { onDirtyChange(dirty || save.isPending); return () => onDirtyChange(false); }, [dirty, save.isPending, onDirtyChange]);
  const submit = () => {
    if (!base || !value || query.error || comparing) return;
    const signature = JSON.stringify([base.revision, value]);
    if (receipt.current?.signature !== signature) receipt.current = { signature, input: { expectedRevision: base.revision, requestKey: crypto.randomUUID(), visibility: value } };
    setUnconfirmed(true); save.mutate(receipt.current.input);
  };
  const compare = async () => {
    setComparing(true); setReadError(undefined); setLatest(undefined);
    try { setLatest(await read()); } catch (error) { setReadError(errorMessage(error)); }
    finally { setComparing(false); }
  };
  const useLatest = () => {
    if (!latest || !value) return;
    setEdit({ base: latest, visibility: value }); setLatest(undefined); setUnconfirmed(false); receipt.current = undefined; save.reset();
  };
  return <>
    <UnsavedChangesGuard dirty={dirty || save.isPending} scope={t('admin.pricing.visibility.title')} isNavigationBusy={() => save.isPending} />
    {open ? <FormDialog title={t('admin.pricing.visibility.editTitle', { name: project.name })} submitLabel={t('admin.pricing.visibility.save')}
      busy={save.isPending || comparing} submitDisabled={!base || !!query.error || !dirty} error={save.error ? errorMessage(save.error) : undefined}
      onSubmit={submit} onClose={onClose} onClear={onClear} dirty={dirty}>
      <Stack>
        <p>{t('admin.pricing.visibility.hint')}</p>
        <QueryStatus isPending={query.isPending} error={query.error} />
        {base && value ? <>
          <p>{t('admin.pricing.visibility.revision', { revision: base.revision })}</p>
          <AdminField label={t('admin.pricing.visibility.setting')} value={value} disabled={save.isPending || comparing || !!query.error}
            options={(['hidden', 'project-members-and-services'] as const).map((option) => ({ value: option, label: t('admin.pricing.visibility.' + option) }))}
            onChange={(choice) => setEdit({ base, visibility: choice as ExecutionCostVisibility })} />
        </> : null}
        {save.error ? <>
          <Button disabled={comparing} onClick={() => void compare()}>{t('admin.pricing.visibility.compare')}</Button>
          {readError ? <p role="alert">{readError}</p> : null}
          {latest ? <><p>{t('admin.pricing.visibility.latest', { revision: latest.revision, setting: t('admin.pricing.visibility.' + latest.visibility) })}</p>
            <Button onClick={useLatest}>{t('admin.pricing.useLatest')}</Button></> : null}
        </> : null}
      </Stack>
    </FormDialog> : null}
  </>;
}
