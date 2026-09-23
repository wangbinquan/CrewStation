import type { ApiOperationDto } from '@crewstation/contracts';
import { ApiOperationDtoSchema } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { useCatalogActions } from '../hooks/useCatalogActions';
import { useCatalogData } from '../hooks/useCatalogData';
import { OperationDetail } from './OperationDetail';
import { RequestsPanel } from './RequestsPanel';
import { SwaggerPanel } from './SwaggerPanel';
import { ApiInvocationWorkspace } from './invocation/ApiInvocationWorkspace';
import { OperationList } from './list/OperationList';
import type { PlatformEndpoint } from './list/operationSections';
import styles from './CatalogContent.module.css';

export interface CatalogContentProps {
  readonly projectId: string;
  /** 已确定的服务 ID：目录的 granted 与裁剪都以它为准，页面在拿到之前不渲染本组件。 */
  readonly serviceId: string;
  readonly canDevelop?: boolean;
  /** 紧凑形态：只列已授权操作与试调，不含申请记录与 Swagger。 */
  readonly compact?: boolean;
  /** 紧凑形态在工具面板里：内容短时把最后一张卡（操作表）拉到面板底边。 */
  readonly fill?: boolean;
  readonly proxy?: string;
  /** 放大形态里是选中的操作（表仍列全部）；紧凑形态里是筛选。 */
  readonly operation?: string;
  readonly onClearContext?: () => void;
  /** 放大形态选中一行时写回地址；没给就只在本页记住。 */
  readonly onSelect?: (operation: ApiOperationDto | undefined) => void;
  /** 平台自己的接口（业务子任务），列在「可调用」里。 */
  readonly platform?: readonly PlatformEndpoint[];
}

/** 目录页正文：放大形态「列表在前、详情在旁」（RFC-020 design §7）；侧栏形态只有列表，试调在该行下原地展开。 */
export function CatalogContent({ projectId, serviceId, canDevelop = false, compact = false, fill = false, proxy, operation, onClearContext, onSelect, platform }: CatalogContentProps): ReactElement {
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
  const list = { operations: operations.data?.items ?? [], requests: requests.data?.items ?? [], loading: operations.isPending, loadError: operations.error, actions, platform };
  if (compact) return (
    <div className={fill ? `${styles.stack} ${styles.fill}` : styles.stack}>
      <ApiInvocationWorkspace inline context={context}>{({ open, panel, active }) =>
        <OperationList {...list} proxy={proxy} operation={operation} onClearContext={onClearContext} onInvoke={canDevelop ? open : undefined} active={active?.id} activePanel={active ? panel : undefined} notice={active ? undefined : panel} />}
      </ApiInvocationWorkspace>
    </div>
  );
  return (
    <ApiInvocationWorkspace context={context}>{({ controller, open, panel }) => <div className={styles.host}><div className={styles.columns}>
      <div className={styles.stack}>
        <OperationList {...list} proxy={proxy} operation={selectedId} onClearContext={() => { setLocal({ request: false }); onClearContext?.(); }} onInvoke={canDevelop ? (item) => { select(item); open(item); } : undefined} onSelect={select} />
        <RequestsPanel requests={requests.data?.items ?? []} loading={requests.isPending} loadError={requests.error} describeOperation={(id) => { const item = list.operations.find((entry) => entry.id === id); return item ? `${item.proxy} ${item.method} ${item.path}` : undefined; }} />
        <SwaggerPanel serviceId={serviceId} proxies={proxies.data?.items ?? []} initialProxy={proxy} invocation={{ controller, operations: context.operations, canDevelop }} />
      </div>
      {/* 详情栏：选中操作的文档与申请在上，试调面板（会话绑定、表单、结果）在下——没选中时会话绑定也要能看、能重绑。 */}
      <aside className={styles.aside} aria-label={t('catalog.detail.title')}>
        <OperationDetail operation={selected} missingId={missingId} onClear={clear} pendingRequest={pending} actions={actions} requesting={local.request && local.id === selectedId} onInvoke={canDevelop ? open : undefined} />
        {panel}
      </aside>
    </div></div>}</ApiInvocationWorkspace>
  );
}
