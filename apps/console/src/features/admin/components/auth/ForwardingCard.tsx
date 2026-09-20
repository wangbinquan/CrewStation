import type { ForwardingCandidate, ProjectId } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useApiMutation, useApiQuery } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../../shared/ui/InlineConfirm';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { AdminField } from '../AdminField';
import { AdminForm } from '../AdminForm';
import { MutationError } from '../MutationError';

function candidateLabel(candidate: ForwardingCandidate, t: (key: string) => string): string {
  return candidate.kind === 'fixed' ? t(`admin.auth.field.${candidate.key}`) : `${candidate.key}（${candidate.providers.join('、')}）`;
}

/**
 * 身份转发（RFC-005 §6.4）：全局默认集与按项目覆盖。
 * 平台侧档案始终存全量，这里只决定**外发**哪些字段；关掉的字段业务连头都收不到。
 */
export function ForwardingCard(): ReactElement {
  const t = useT();
  const [projectId, setProjectId] = useState('');
  const [projectFields, setProjectFields] = useState('');
  const forwarding = useApiQuery(queryKeys.identityForwarding(), () => api.auth.forwarding());
  const invalidate = [queryKeys.identityForwarding()];
  const setGlobal = useApiMutation((fields: string[]) => api.auth.setGlobalForwarding({ fields }), { invalidate });
  const setProject = useApiMutation((input: { projectId: string; fields: string[] }) => api.auth.setProjectForwarding(input.projectId, { fields: input.fields }), { invalidate });
  const clearProject = useApiMutation((id: string) => api.auth.clearProjectForwarding(id), { invalidate });
  const data = forwarding.data;
  const globalFields = new Set(data?.global.fields ?? []);

  return (
    <Card stacked title={t('admin.auth.forwardingTitle')} footer={t('admin.auth.forwardingHint')}>
      <MutationError error={setGlobal.error ?? setProject.error ?? clearProject.error} messageKey="admin.auth.forwardingSaveError" />
      <QueryStatus isPending={forwarding.isPending} error={forwarding.error} />
      {data === undefined ? null : (
        <>
          <p>{t('admin.auth.forwardingFixed')}</p>
          <DataTable columns={[t('admin.auth.field'), t('admin.auth.source'), t('admin.auth.forwarded'), t('admin.auth.actions')]}>
            {data.candidates.map((candidate) => (
              <tr key={candidate.key}>
                <td><code>{candidate.key}</code> {candidateLabel(candidate, t)}</td>
                <td>{candidate.kind === 'fixed' ? t('admin.auth.sourceFixed') : t('admin.auth.sourceMapped')}</td>
                <td><Badge tone={globalFields.has(candidate.key) ? 'info' : 'neutral'}>{globalFields.has(candidate.key) ? t('admin.auth.on') : t('admin.auth.off')}</Badge></td>
                <td>
                  {globalFields.has(candidate.key) ? (
                    <InlineConfirm
                      label={t('admin.auth.stopForwarding')}
                      question={t('admin.auth.stopForwardingQuestion')}
                      variant="ghost"
                      busy={setGlobal.isPending}
                      busyLabel={t('admin.auth.saving')}
                      onConfirm={() => setGlobal.mutate([...globalFields].filter((key) => key !== candidate.key))}
                    />
                  ) : (
                    <Button variant="ghost" disabled={setGlobal.isPending} onClick={() => setGlobal.mutate([...globalFields, candidate.key])}>
                      {t('admin.auth.startForwarding')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>

          <p>{t('admin.auth.overridesTitle')}</p>
          {data.projects.length === 0 ? <p>{t('admin.auth.overridesEmpty')}</p> : (
            <DataTable columns={[t('admin.auth.project'), t('admin.auth.forwardedFields'), t('admin.auth.actions')]}>
              {data.projects.map((override) => (
                <tr key={override.projectId}>
                  <td><code>{override.projectId}</code></td>
                  <td>{override.fields.length === 0 ? t('admin.auth.noneForwarded') : override.fields.join('、')}</td>
                  <td>
                    <InlineConfirm
                      label={t('admin.auth.clearOverride')}
                      question={t('admin.auth.clearOverrideQuestion')}
                      variant="ghost"
                      busy={clearProject.isPending && clearProject.variables === override.projectId}
                      busyLabel={t('admin.auth.saving')}
                      onConfirm={() => clearProject.mutate(override.projectId)}
                    />
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
          <AdminForm
            submitLabel={t('admin.auth.setOverride')}
            busyLabel={t('admin.auth.saving')}
            busy={setProject.isPending}
            incomplete={projectId === ''}
            note={t('admin.auth.overrideNote')}
            onSubmit={() => setProject.mutate({ projectId: projectId as ProjectId, fields: projectFields.split(',').map((f) => f.trim()).filter((f) => f !== '') })}
          >
            <AdminField label={t('admin.auth.project')} value={projectId} onChange={setProjectId} placeholder="prj_…" />
            <AdminField label={t('admin.auth.forwardedFields')} value={projectFields} onChange={setProjectFields} hint={t('admin.auth.overrideFieldsHint')} placeholder="name, email" />
          </AdminForm>
        </>
      )}
    </Card>
  );
}
