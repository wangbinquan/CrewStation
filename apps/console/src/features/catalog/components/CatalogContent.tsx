import type { ApiOperationDto } from '@crewstation/contracts';
import { ApiOperationDtoSchema } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { useCatalogActions } from '../hooks/useCatalogActions';
import { useCatalogData } from '../hooks/useCatalogData';
import { OperationDetail } from './OperationDetail';
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
  /** 紧凑形态：只列已授权操作与试调，不含申请记录与 Swagger。 */
  readonly compact?: boolean;
  readonly proxy?: string;
  /** 放大形态里是选中的操作（表仍列全部）；紧凑形态里是筛选。 */
  readonly operation?: string;
  readonly onClearContext?: () => void;
  /** 放大形态选中一行时写回地址；没给就只在本页记住。 */
  readonly onSelect?: (operation: ApiOperationDto | undefined) => void;
}

/** 目录页正文：放大形态「表在前、详情在旁」（RFC-020 design §7），Swagger 折叠；紧凑形态只有表与试调。 */
export function CatalogContent({ projectId, serviceId, canDevelop = false, compact = false, proxy, operation, onClearContext, onSelect }: CatalogContentProps): ReactElement {
  const t = useT();
  const { operations, requests, proxies } = useCatalogData(projectId, serviceId);
  const actions = useCatalogActions(serviceId);
  const parsed = ApiOperationDtoSchema.array().safeParse(operations.data?.items);
  const context = { projectId, canDevelop, operations: parsed.success ? parsed.data : [], catalogReady: !operations.error && parsed.success };
  const [local, setLocal] = useState<{ id?: string; request: boolean }>({ request: false });
  const selectedId = onSelect ? operation : local.id;
  const select = (item: ApiOperationDto, options?: { readonly request?: boolean }) => { setLocal({ id: item.id, request: !!options?.request }); onSelect?.(item); };
  const clear = () => { setLocal({ request: false }); onSelect?.(undefined); };
  const missingId = selectedId && operations.data && !operations.data.items.some((item) => item.id === selectedId) ? selectedId : undefined;
  const selected = (operations.data?.items ?? []).find((item) => item.id === selectedId);
  const pending = (requests.data?.items ?? []).find((item) => item.state === 'pending' && item.operationId === selectedId);
  if (compact) return (
    <div className={styles.stack}>
      <ApiInvocationWorkspace context={context}>{(_controller, open, panel) => <>
        {panel}
        <OperationsPanel operations={operations.data?.items ?? []} requests={requests.data?.items ?? []} loading={operations.isPending} loadError={operations.error} actions={actions} proxy={proxy} operation={operation} onClearContext={onClearContext} onInvoke={canDevelop ? open : undefined} grantedOnly />
      </>}</ApiInvocationWorkspace>
    </div>
  );
  return (
    <ApiInvocationWorkspace context={context}>{(controller, open, panel) => <div className={styles.columns}>
      <div className={styles.stack}>
        <OperationsPanel operations={operations.data?.items ?? []} requests={requests.data?.items ?? []} loading={operations.isPending} loadError={operations.error} actions={actions}
          proxy={proxy} operation={selectedId} onClearContext={() => { setLocal({ request: false }); onClearContext?.(); }} onInvoke={canDevelop ? (item) => { select(item); open(item); } : undefined} onSelect={select} />
        <RequestsPanel requests={requests.data?.items ?? []} loading={requests.isPending} loadError={requests.error} />
        <SwaggerPanel serviceId={serviceId} proxies={proxies.data?.items ?? []} initialProxy={proxy} invocation={{ controller, operations: context.operations, canDevelop }} />
      </div>
      {/* 详情栏：选中操作的文档与申请在上，试调面板（会话绑定、表单、结果）在下——没选中时会话绑定也要能看、能重绑。 */}
      <aside className={styles.aside} aria-label={t('catalog.detail.title')}>
        <OperationDetail operation={selected} missingId={missingId} onClear={clear} pendingRequest={pending} actions={actions} requesting={local.request && local.id === selectedId} onInvoke={canDevelop ? open : undefined} />
        {panel}
      </aside>
    </div>}</ApiInvocationWorkspace>
  );
}
