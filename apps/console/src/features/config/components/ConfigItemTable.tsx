import type { ConfigItemDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import styles from './ConfigItemTable.module.css';

export interface ConfigItemTableProps {
  readonly items: readonly ConfigItemDto[];
  readonly onEdit: (item: ConfigItemDto) => void;
  readonly onDelete: (item: ConfigItemDto) => void;
  readonly deletingName: string | undefined;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

/**
 * 取值列表。删除不可撤销，走弹窗并输入 delete（2026-09-23 作者裁定）；删除由面板发起，确认后弹窗即关，
 * 进行中的反馈在该行的删除键上，结果由面板显示。
 */
export function ConfigItemTable({ items, onEdit, onDelete, deletingName, disabled = false, readOnly = false }: ConfigItemTableProps): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const [confirming, setConfirming] = useState<ConfigItemDto>();
  const columns = [t('config.items.name'), t('config.items.value'), ...(!readOnly ? [t('config.items.actions')] : [])];
  return (
    <>
    <DataTable columns={columns} className={styles.table}>
      {items.map((item) => (
        <tr key={item.id}>
          <td>
            <span>{item.name}</span> <code>{item.bindingName}</code><details><summary>ID</summary><code>{item.id}</code></details>
            <details><summary>{t('config.itemDetails')}</summary><div className={styles.metadata}>
              <span>{t('config.items.version')}: {item.version}</span>
              <span>{t('config.items.updatedBy')}: {item.updatedBy}</span>
              <span>{t('config.items.updatedAt')}: {dateText(item.updatedAt)}</span>
            </div></details>
          </td>
          <td>
            <ConfigItemValue item={item} />
          </td>
          {!readOnly ? <td className={styles.actions}>
            <Button size="small" disabled={disabled} onClick={() => onEdit(item)}>
              {t(item.isSecret ? 'config.updateSecret' : 'config.items.edit')}
            </Button>
            <Button variant="danger" size="small" disabled={disabled || deletingName === item.id} onClick={() => setConfirming(item)}>
              {t(deletingName === item.id ? 'config.items.deleting' : 'config.items.delete')}
            </Button>
          </td> : null}
        </tr>
      ))}
    </DataTable>
    {confirming ? <ConfirmDialog title={t('config.items.deleteTitle')} question={t('config.items.deleteQuestion', { name: confirming.name, binding: confirming.bindingName })} confirmWord="delete"
      confirmLabel={t('config.items.deleteConfirm')} confirmDisabled={disabled} onConfirm={() => { setConfirming(undefined); onDelete(confirming); }} onCancel={() => setConfirming(undefined)}>
      <p>{t('config.items.deleteHint')}</p>
      {confirming.isSecret ? <p>{t('config.items.deleteSecretHint')}</p> : null}
    </ConfirmDialog> : null}
    </>
  );
}

/** Secret 永远不带 value：渲染占位符并说明只写不读，绝不假装展示真值。 */
function ConfigItemValue({ item }: { readonly item: ConfigItemDto }): ReactElement {
  const t = useT();
  if (item.isSecret) {
    return (
      <span className={styles.secret} title={t('config.items.secretWriteOnly')}>
        <Badge tone="warning">{t('config.items.secret')}</Badge>
        <code>{t('config.items.secretMasked')}</code>
      </span>
    );
  }
  return <code className={styles.value}>{item.value ?? ''}</code>;
}
