import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { CopyButton } from '../../../../shared/ui/clipboard/CopyButton';
import { BreakableText, MetaLine, MethodTag, ResourceRow } from '../../../../shared/ui/resource/ResourceList';
import type { CatalogActions } from '../../hooks/useCatalogActions';
import { OperationActions } from '../OperationActions';
import { internalCallUrl, operationStatus, platformCallUrl } from './operationSections';
import type { PlatformEndpoint } from './operationSections';
import styles from './OperationList.module.css';

/** 可调用的在「可调用」组里、可申请的有「申请」按钮，都不再挂状态标签；只有审批中与未授权要标出来。 */
const STATUS_TONE = { pending: 'info', blocked: 'neutral' } as const;

/** 调用地址一行：代码里就写这个；复制按钮就在旁边。 */
export function CallAddress({ url, note }: { readonly url: string; readonly note: string }): ReactElement {
  const t = useT();
  return <div className={styles.address}>
    <span className={styles.addressLabel}>{t('catalog.list.address')}</span>
    <code className={styles.addressValue}><BreakableText text={url} /></code><CopyButton value={url} />
    <p className={styles.addressNote}>{note}</p>
  </div>;
}

export interface OperationRowProps {
  readonly operation: ApiOperationDto;
  readonly pending: ReadonlyMap<string, ApiRequestDto>;
  readonly actions: CatalogActions;
  /** 放大形态：点行选中（详情在旁），不在行下展开。 */
  readonly full: boolean;
  readonly current?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly requesting: boolean;
  readonly onRequest: () => void;
  readonly onRequestClose: () => void;
  readonly onInvoke?: (operation: ApiOperationDto) => void;
  readonly onSelect?: (operation: ApiOperationDto) => void;
  readonly activePanel?: ReactNode;
}

export function OperationRow({ operation, pending, actions, full, current, expanded, onToggle, requesting, onRequest, onRequestClose, onInvoke, onSelect, activePanel }: OperationRowProps): ReactElement {
  const t = useT(), status = operationStatus(operation, pending);
  const trailing = <>
    {status === 'pending' || status === 'blocked' ? <Badge tone={STATUS_TONE[status]}>{t(`catalog.list.status.${status}`)}</Badge> : null}
    {status === 'callable' && onInvoke && !activePanel ? <Button size="small" onClick={() => onInvoke(operation)}>{t('catalog.invoke.open')}</Button> : null}
    {status === 'requestable' && !requesting ? <Button size="small" aria-label={`${t('catalog.request.action')} ${operation.method} ${operation.path}`} onClick={onRequest}>{t('catalog.list.request')}</Button> : null}
  </>;
  const open = !full && (expanded || requesting || !!activePanel);
  return <ResourceRow lead={<MethodTag method={operation.method} />} title={<BreakableText text={operation.path} />} current={current}
    meta={<MetaLine parts={[operation.proxy, operation.summary]} />}
    trailing={trailing} expanded={full ? undefined : open} activateLabel={t(full ? 'catalog.detail.select' : 'catalog.list.expand')}
    onActivate={full && onSelect ? () => onSelect(operation) : onToggle}>
    {open ? <>
      <CallAddress url={internalCallUrl(operation)} note={t(status === 'callable' ? 'catalog.list.noCredential' : 'catalog.list.afterGrant')} />
      {requesting ? <OperationActions operation={operation} pendingRequest={pending.get(operation.id)} actions={actions} onClose={onRequestClose} /> : null}
      {activePanel}
    </> : null}
  </ResourceRow>;
}

/** 平台接口（业务子任务）：总是可调，不走目录与试调，展开只给调用地址。 */
export function PlatformRow({ endpoint, expanded, onToggle }: { readonly endpoint: PlatformEndpoint; readonly expanded: boolean; readonly onToggle: () => void }): ReactElement {
  const t = useT();
  return <ResourceRow lead={<MethodTag method={endpoint.method} />} title={<BreakableText text={endpoint.path} />} expanded={expanded} onActivate={onToggle} activateLabel={t('catalog.list.expand')}
    meta={<MetaLine parts={[t('catalog.list.platformProvider'), endpoint.summary]} />}>
    {expanded ? <CallAddress url={platformCallUrl(endpoint)} note={t('catalog.list.platformNote')} /> : null}
  </ResourceRow>;
}
