import type { AddEgressEntryRequest, EgressScope, ProjectId } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { AdminForm } from './AdminForm';
import { AdminField } from './AdminField';

export interface EgressEntryFormProps {
  readonly onSubmit: (input: AddEgressEntryRequest) => void;
  readonly busy: boolean;
  readonly error?: ReactNode;
}

/** 追加一条出站白名单条目：global 对所有项目生效，project 必须指明项目。 */
export function EgressEntryForm({ onSubmit, busy, error }: EgressEntryFormProps): ReactElement {
  const t = useT();
  const [fqdn, setFqdn] = useState('');
  const [scope, setScope] = useState<EgressScope>('global');
  const [projectId, setProjectId] = useState('');
  const [note, setNote] = useState('');
  const incomplete = fqdn === '' || (scope === 'project' && projectId === '');
  // 工作台不做 zod 解析，ID 的格式由服务端按 Schema 校验；这里只是把输入按契约类型交出去。
  const submit = (): void =>
    onSubmit({
      fqdn,
      scope,
      projectId: scope === 'project' ? (projectId as ProjectId) : undefined,
      note: note === '' ? undefined : note,
    });
  return (
    <AdminForm
      submitLabel={t('admin.egress.add')}
      busyLabel={t('admin.egress.adding')}
      busy={busy}
      incomplete={incomplete}
      error={error}
      note={t('admin.egress.projectIdHint')}
      onSubmit={submit}
    >
      <AdminField label={t('admin.egress.fqdn')} value={fqdn} onChange={setFqdn} placeholder={t('admin.egress.fqdnPlaceholder')} />
      <AdminField
        label={t('admin.egress.scope')}
        value={scope}
        onChange={(next) => setScope(next as EgressScope)}
        options={[
          { value: 'global', label: t('admin.egress.scopeGlobal') },
          { value: 'project', label: t('admin.egress.scopeProject') },
        ]}
      />
      <AdminField
        label={t('admin.egress.projectId')}
        value={projectId}
        onChange={setProjectId}
        disabled={scope !== 'project'}
        title={t('admin.egress.projectIdHint')}
        placeholder={t('admin.egress.projectIdPlaceholder')}
      />
      <AdminField label={t('admin.egress.note')} value={note} onChange={setNote} />
    </AdminForm>
  );
}
