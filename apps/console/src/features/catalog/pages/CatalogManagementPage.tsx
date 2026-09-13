import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { FormField } from '../../../shared/ui/FormField';
import { Card } from '../../../shared/ui/Card';
import { Button } from '../../../shared/ui/Button';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { CatalogManagementOperations } from '../components/management/CatalogManagementOperations';
import styles from '../components/CatalogContent.module.css';

/** app 的管理守卫先裁定身份；此处只组织真实目录及明确选中的调用方。 */
export function CatalogManagementPage({ projectId, proxy, operation, onProjectChange, onClearContext }: {
  readonly projectId?: string; readonly proxy?: string; readonly operation?: string;
  readonly onProjectChange: (projectId?: string) => void; readonly onClearContext: () => void;
}) {
  const t = useT(), projects = useApiQuery(queryKeys.adminProjects(), () => api.projects.list());
  const selected = projects.data?.items.find((item) => item.id === projectId);
  const ready = !projectId || (!projects.error && !projects.isPending && selected?.serviceId);
  return <div className={styles.stack}>
    <Card title={t('catalog.admin.scopeTitle')}>
      <FormField label={t('catalog.admin.scope')} hint={t('catalog.admin.scopeHint')}><select value={projectId ?? ''} onChange={(event) => onProjectChange(event.target.value || undefined)}>
        <option value="">{t('catalog.admin.allOperations')}</option>
        {projectId && !selected ? <option value={projectId}>{projectId}</option> : null}
        {(projects.data?.items ?? []).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.slug}</option>)}
      </select></FormField>
      <QueryStatus isPending={projects.isPending} error={projects.error} />
      {projects.error ? <Button onClick={() => void projects.refetch()}>{t('catalog.admin.retryProjects')}</Button> : null}
      {projectId && !projects.isPending && !projects.error && !selected ? <EmptyState title={t('catalog.admin.unknownProject')} description={projectId} /> : null}
      {selected && !selected.serviceId ? <EmptyState title={t('catalog.service.missingTitle')} description={t('catalog.service.missingDescription')} /> : null}
      {selected?.serviceId ? <p>{t('catalog.admin.currentService')} <code>{selected.serviceId}</code></p> : null}
    </Card>
    {ready ? <CatalogManagementOperations key={selected?.serviceId ?? 'platform'} serviceId={selected?.serviceId} projectName={selected?.name} proxy={proxy} operation={operation} onClearContext={onClearContext} /> : null}
  </div>;
}
