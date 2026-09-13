import { CatalogManagementOperations } from '../components/management/CatalogManagementOperations';
import { CatalogCallerPicker } from '../components/management/CatalogCallerPicker';
import { useCatalogCaller } from '../hooks/useCatalogCaller';
import styles from '../components/CatalogContent.module.css';

/** 目录分页与已选调用方分别读取；项目未确认时不挂载全局策略作为替代。 */
export function CatalogManagementPage({ projectId, proxy, operation, q, cursor, onProjectChange, onClearContext, onDirectoryChange }: {
  readonly projectId?: string; readonly proxy?: string; readonly operation?: string; readonly q?: string; readonly cursor?: string;
  readonly onProjectChange: (projectId?: string) => void; readonly onClearContext: () => void;
  readonly onDirectoryChange: (q: string, cursor?: string) => void;
}) {
  const caller = useCatalogCaller(projectId, q, cursor);
  return <div className={styles.stack}>
    <CatalogCallerPicker key={q ?? ''} data={caller} projectId={projectId} q={q} cursor={cursor} onChange={onProjectChange} onSearch={onDirectoryChange} />
    {caller.ready ? <CatalogManagementOperations key={caller.project?.serviceId ?? 'platform'} serviceId={caller.project?.serviceId} projectName={caller.project?.name} proxy={proxy} operation={operation} onClearContext={onClearContext} /> : null}
  </div>;
}
