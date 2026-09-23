import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Button } from '../../../../shared/ui/Button';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { errorMessage } from '../../../../shared/api/useApi';
import { ResourceGroup, ResourceList } from '../../../../shared/ui/resource/ResourceList';
import type { CatalogActions } from '../../hooks/useCatalogActions';
import { indexPending, INITIAL_OPERATION_FILTER, sectionOperations } from './operationSections';
import type { OperationListFilter, PlatformEndpoint } from './operationSections';
import { OperationRow, PlatformRow } from './OperationRow';
import { OperationToolbar } from './OperationToolbar';
import styles from './OperationList.module.css';

export interface OperationListProps {
  readonly operations: readonly ApiOperationDto[];
  readonly requests: readonly ApiRequestDto[];
  readonly loading: boolean;
  readonly loadError: unknown;
  readonly actions: CatalogActions;
  /** 平台自己的接口（业务子任务），放在「可调用」里。 */
  readonly platform?: readonly PlatformEndpoint[];
  /** 地址里带来的代理（筛选）与操作（侧栏里是筛选，放大形态里是选中）。 */
  readonly proxy?: string;
  readonly operation?: string;
  readonly onClearContext?: () => void;
  readonly onInvoke?: (operation: ApiOperationDto) => void;
  /** 放大形态：点行选中，详情、申请与试调在右侧详情栏。 */
  readonly onSelect?: (operation: ApiOperationDto, options?: { readonly request?: boolean }) => void;
  /** 侧栏形态：正在试调的操作，它的试调面板在该行下原地展开。 */
  readonly active?: string;
  readonly activePanel?: ReactNode;
  /** 列表上方的一条提示（如试调因没有会话打不开）。 */
  readonly notice?: ReactNode;
}

/** 接口列表（开发页「可使用资源 → 调用接口」）：可调用的置顶，需申请的在分割线下；每条两行，不出现操作 ID。 */
export function OperationList(props: OperationListProps): ReactElement {
  const { operations, requests, loading, loadError, actions, platform = [], proxy, operation, onClearContext, onSelect, notice } = props;
  const t = useT();
  const [filter, setFilter] = useState<OperationListFilter>(INITIAL_OPERATION_FILTER);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set()), [requesting, setRequesting] = useState<string>();
  const pending = useMemo(() => indexPending(requests), [requests]);
  const focused = !onSelect && operation ? operations.find((item) => item.id === operation) : undefined;
  const scoped = useMemo(() => operations.filter((item) => (!proxy || item.proxyId === proxy) && (onSelect || !operation || item.id === operation)), [operations, proxy, operation, onSelect]);
  const sections = useMemo(() => sectionOperations(scoped, proxy || (!onSelect && operation) ? [] : platform, pending, filter), [scoped, platform, pending, filter, proxy, operation, onSelect]);
  const providers = useMemo(() => [...new Map(operations.map((item) => [item.proxyId, { id: item.proxyId, name: item.proxy }])).values()].sort((a, b) => a.name.localeCompare(b.name)), [operations]);
  const toggle = (key: string) => setExpanded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const count = sections.callable.length + sections.platform.length + sections.other.length;
  // 定位只写人读得懂的「方法 路径」或代理名；找不到才原样给出地址里的值。
  const context = !onSelect && operation ? { key: 'catalog.list.focusOperation', value: focused ? `${focused.method} ${focused.path}` : operation }
    : proxy ? { key: 'catalog.list.focusProvider', value: providers.find((item) => item.id === proxy)?.name ?? proxy } : undefined;
  const row = (item: ApiOperationDto) => <OperationRow key={item.id} operation={item} pending={pending} actions={actions} full={!!onSelect}
    current={onSelect ? operation === item.id : undefined} expanded={expanded.has(item.id)} onToggle={() => toggle(item.id)}
    requesting={requesting === item.id} onRequest={() => (onSelect ? onSelect(item, { request: true }) : setRequesting(item.id))} onRequestClose={() => setRequesting(undefined)}
    onInvoke={props.onInvoke} onSelect={onSelect} activePanel={props.active === item.id ? props.activePanel : undefined} />;
  return <div className={styles.list}>
    {context ? <p className={styles.context}>{t(context.key)} <code>{context.value}</code> <Button size="small" variant="ghost" onClick={onClearContext}>{t('catalog.clearContext')}</Button></p> : null}
    <OperationToolbar value={filter} providers={providers} platform={platform.length > 0} count={count} onChange={setFilter} />
    {notice}
    {actions.requestAccess.error ? <ActionNote tone="error">{t('catalog.error.write', { message: errorMessage(actions.requestAccess.error) })}</ActionNote> : null}
    <QueryStatus isPending={loading} error={loadError} loadingKey="catalog.operations.loading" errorKey="catalog.error.load"
      isEmpty={count === 0} emptyTitle={t('catalog.operations.emptyTitle')} emptyDescription={t('catalog.operations.emptyDescription')} />
    {count > 0 ? <ResourceList label={t('catalog.list.label')}>
      {sections.callable.length + sections.platform.length > 0 ? <ResourceGroup title={t('catalog.list.callable')} count={sections.callable.length + sections.platform.length}>
        {sections.callable.map(row)}
        {sections.platform.map((item) => <PlatformRow key={`${item.method} ${item.path}`} endpoint={item} expanded={expanded.has(`platform:${item.method} ${item.path}`)} onToggle={() => toggle(`platform:${item.method} ${item.path}`)} />)}
      </ResourceGroup> : null}
      {sections.other.length > 0 ? <ResourceGroup title={t('catalog.list.other')} count={sections.other.length} note={t('catalog.list.otherNote')}>{sections.other.map(row)}</ResourceGroup> : null}
    </ResourceList> : null}
  </div>;
}
