import type { ApiOperationDto, ApiRequestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { CatalogActions } from '../hooks/useCatalogActions';
import { OperationActions } from './OperationActions';
import styles from './CatalogContent.module.css';

export interface OperationDetailProps {
  readonly operation?: ApiOperationDto;
  readonly pendingRequest?: ApiRequestDto;
  readonly actions: CatalogActions;
  /** 从表里的「申请定向开放」进来：申请表单直接展开。 */
  readonly requesting: boolean;
  readonly onInvoke?: (operation: ApiOperationDto) => void;
  /** 地址里指定的操作不在目录里：如实说明，不偷偷展示别的操作。 */
  readonly missingId?: string;
  readonly onClear?: () => void;
}

/** 选中操作的详情栏（RFC-020 design §7）：文档、开放策略与授权状态、申请表单、试调；没选时说明怎么选。 */
export function OperationDetail({ operation, pendingRequest, actions, requesting, onInvoke, missingId, onClear }: OperationDetailProps): ReactElement {
  const t = useT();
  if (!operation) return <Card compact title={t('catalog.detail.title')}>{missingId ? <ActionNote tone="error">{t('catalog.detail.missing', { id: missingId })}</ActionNote> : null}<p className={styles.muted}>{t('catalog.detail.empty')}</p>{missingId && onClear ? <Button variant="ghost" onClick={onClear}>{t('catalog.detail.clear')}</Button> : null}</Card>;
  const granted = operation.granted === true;
  return <Card compact title={operation.summary ?? operation.id} extra={<><Badge tone={granted ? 'success' : 'neutral'}>{granted ? t('catalog.granted.yes') : t('catalog.granted.no')}</Badge>{onClear ? <Button variant="ghost" onClick={onClear}>{t('catalog.detail.clear')}</Button> : null}</>}>
    <DefinitionList items={[
      { label: t('catalog.operations.key'), value: <code>{operation.id}</code> },
      { label: t('catalog.operations.proxy'), value: operation.proxy },
      { label: t('catalog.detail.endpoint'), value: <code>{operation.method} {operation.path}</code> },
      { label: t('catalog.operations.policy'), value: <Badge tone={operation.openPolicy === 'default' ? 'success' : 'warning'}>{t(`catalog.policy.${operation.openPolicy}`)}</Badge> },
    ]} />
    <div className={styles.detailActions}>
      <OperationActions key={`${operation.id}:${requesting}`} operation={operation} pendingRequest={pendingRequest} actions={actions} initiallyRequesting={requesting} />
      {onInvoke && granted ? <Button onClick={() => onInvoke(operation)}>{t('catalog.invoke.open')}</Button> : null}
    </div>
  </Card>;
}
