import type { ReactElement } from 'react';
import { ApiOperationDtoSchema } from '@crewstation/contracts';
import { useCatalogActions } from '../hooks/useCatalogActions';
import { useCatalogData } from '../hooks/useCatalogData';
import { OperationsPanel } from './OperationsPanel';
import { RequestsPanel } from './RequestsPanel';
import { SwaggerPanel } from './SwaggerPanel';
import { ApiInvocationWorkspace } from './invocation/ApiInvocationWorkspace';
import styles from './CatalogContent.module.css';

export interface CatalogContentProps {
  readonly projectId: string;
  /** 已确定的服务 ID：目录的 granted 与裁剪都以它为准，页面在拿到之前不渲染本组件。 */
  readonly serviceId: string;
  readonly canDevelop?: boolean;
  readonly proxy?: string;
  readonly operation?: string;
  readonly onClearContext?: () => void;
}

/** 目录页正文：操作表、本服务的申请、内嵌 Swagger。 */
export function CatalogContent({ projectId, serviceId, canDevelop = false, proxy, operation, onClearContext }: CatalogContentProps): ReactElement {
  const { operations, requests, proxies } = useCatalogData(projectId, serviceId);
  const actions = useCatalogActions(serviceId);
  const parsed = ApiOperationDtoSchema.array().safeParse(operations.data?.items);
  const context = { projectId, canDevelop, operations: parsed.success ? parsed.data : [], catalogReady: !operations.error && parsed.success };
  return (
    <div className={styles.stack}>
      <ApiInvocationWorkspace context={context}>{(controller, open) => <>
      <OperationsPanel
        operations={operations.data?.items ?? []}
        requests={requests.data?.items ?? []}
        loading={operations.isPending}
        loadError={operations.error}
        actions={actions}
        proxy={proxy} operation={operation} onClearContext={onClearContext}
        onInvoke={canDevelop ? open : undefined}
      />
      <RequestsPanel requests={requests.data?.items ?? []} loading={requests.isPending} loadError={requests.error} />
      <SwaggerPanel serviceId={serviceId} proxies={proxies.data?.items ?? []} initialProxy={proxy} invocation={{ controller, operations: context.operations, canDevelop }} />
      </>}</ApiInvocationWorkspace>
    </div>
  );
}
