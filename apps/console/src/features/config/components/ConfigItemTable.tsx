import type { ConfigItemDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { InlineConfirm } from '../../../shared/ui/InlineConfirm';
import styles from './ConfigItemTable.module.css';

export interface ConfigItemTableProps {
  readonly items: readonly ConfigItemDto[];
  readonly onEdit: (item: ConfigItemDto, button: HTMLButtonElement) => void;
  readonly onDelete: (name: string) => void;
  readonly deletingName: string | undefined;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
}

/** 取值列表；删除走行内两步确认，不使用会冻结页面的 window.confirm。 */
export function ConfigItemTable({ items, onEdit, onDelete, deletingName, disabled = false, readOnly = false }: ConfigItemTableProps): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const columns = [t('config.items.name'), t('config.items.value'), ...(!readOnly ? [t('config.items.actions')] : [])];
  return (
    <DataTable columns={columns} className={styles.table}>
      {items.map((item) => (
        <tr key={item.name}>
          <td>
            <code>{item.name}</code>
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
            <Button variant="ghost" disabled={disabled} onClick={(event) => onEdit(item, event.currentTarget)}>
              {t(item.isSecret ? 'config.updateSecret' : 'config.items.edit')}
            </Button>
            <InlineConfirm
              variant="ghost"
              label={t('config.items.delete')}
              question={t('config.items.confirmDelete', { name: item.name })}
              busy={disabled || deletingName === item.name}
              busyLabel={t(deletingName === item.name ? 'config.items.deleting' : 'config.items.delete')}
              onConfirm={() => onDelete(item.name)}
            />
          </td> : null}
        </tr>
      ))}
    </DataTable>
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
