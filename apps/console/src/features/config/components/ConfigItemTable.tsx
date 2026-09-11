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
  readonly onEdit: (item: ConfigItemDto) => void;
  readonly onDelete: (name: string) => void;
  readonly deletingName: string | undefined;
}

/** 取值列表；删除走行内两步确认，不使用会冻结页面的 window.confirm。 */
export function ConfigItemTable({ items, onEdit, onDelete, deletingName }: ConfigItemTableProps): ReactElement {
  const t = useT();
  const dateText = useDateText();
  const columns = [
    t('config.items.name'), t('config.items.value'), t('config.items.version'),
    t('config.items.updatedBy'), t('config.items.updatedAt'), t('config.items.actions'),
  ];
  return (
    <DataTable columns={columns} className={styles.table}>
      {items.map((item) => (
        <tr key={item.name}>
          <td>
            <code>{item.name}</code>
          </td>
          <td>
            <ConfigItemValue item={item} />
          </td>
          <td>{item.version}</td>
          <td>
            <span className={styles.actor} title={item.updatedBy}>
              {item.updatedBy}
            </span>
          </td>
          <td className={styles.muted}>{dateText(item.updatedAt)}</td>
          <td className={styles.actions}>
            <Button variant="ghost" onClick={() => onEdit(item)}>
              {t('config.items.edit')}
            </Button>
            <InlineConfirm
              variant="ghost"
              label={t('config.items.delete')}
              question={t('config.items.confirmDelete', { name: item.name })}
              busy={deletingName === item.name}
              busyLabel={t('config.items.deleting')}
              onConfirm={() => onDelete(item.name)}
            />
          </td>
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
