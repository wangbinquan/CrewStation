import type { AddEgressEntryRequest } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Card } from '../../../shared/ui/Card';
import { AdminTable } from './AdminTable';
import { EgressEntryForm } from './EgressEntryForm';
import { InlineConfirm } from './InlineConfirm';
import { MutationError, SectionStatus } from './SectionStatus';

/** 出站 FQDN 白名单：管理员不带 projectId 查询即看全部条目。 */
export function EgressEntriesSection(): ReactElement {
  const t = useT();
  const { locale } = useI18n();
  const entries = useApiQuery(queryKeys.egressEntries(), () => api.egress.listEntries());
  const add = useApiMutation((input: AddEgressEntryRequest) => api.egress.addEntry(input), { invalidate: [queryKeys.egressEntries()] });
  const remove = useApiMutation((id: string) => api.egress.removeEntry(id), { invalidate: [queryKeys.egressEntries()] });
  const items = entries.data?.items ?? [];
  const columns = [t('admin.egress.fqdn'), t('admin.egress.scope'), t('admin.egress.note'), t('admin.egress.createdAt'), t('admin.egress.actions')];
  return (
    <Card title={t('admin.egress.title')} footer={t('admin.egress.hint')}>
      <MutationError error={remove.error} messageKey="admin.egress.removeError" />
      <SectionStatus
        isPending={entries.isPending}
        error={entries.error}
        isEmpty={items.length === 0}
        emptyTitle={t('admin.egress.emptyTitle')}
        emptyDescription={t('admin.egress.emptyDescription')}
      />
      {items.length > 0 ? (
        <AdminTable columns={columns}>
          {items.map((entry) => (
            <tr key={entry.id}>
              <td>
                <code>{entry.fqdn}</code>
              </td>
              <td>
                <Badge tone={entry.scope === 'global' ? 'info' : 'neutral'}>
                  {entry.scope === 'global' ? t('admin.egress.scopeGlobal') : (entry.projectId ?? t('admin.egress.scopeProject'))}
                </Badge>
              </td>
              <td>{entry.note ?? t('admin.none')}</td>
              <td>{formatDateTime(entry.createdAt, locale)}</td>
              <td>
                <InlineConfirm
                  label={t('admin.egress.remove')}
                  question={t('admin.egress.removeQuestion')}
                  busy={remove.isPending && remove.variables === entry.id}
                  busyLabel={t('admin.egress.removing')}
                  onConfirm={() => remove.mutate(entry.id)}
                />
              </td>
            </tr>
          ))}
        </AdminTable>
      ) : null}
      <EgressEntryForm
        busy={add.isPending}
        error={add.error === null ? undefined : t('admin.egress.addError', { message: errorMessage(add.error) })}
        onSubmit={(input) => add.mutate(input)}
      />
    </Card>
  );
}
