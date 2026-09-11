import type { ConfigItemDto } from '@crewstation/contracts';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { formatDateTime } from '../../../shared/lib/dateFormat';
import { useI18n } from '../../../shared/lib/useI18n';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
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
  const { locale } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('config.items.name')}</th>
            <th>{t('config.items.value')}</th>
            <th>{t('config.items.version')}</th>
            <th>{t('config.items.updatedBy')}</th>
            <th>{t('config.items.updatedAt')}</th>
            <th>{t('config.items.actions')}</th>
          </tr>
        </thead>
        <tbody>
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
              <td className={styles.muted}>{formatDateTime(item.updatedAt, locale)}</td>
              <td className={styles.actions}>
                <Button variant="ghost" onClick={() => onEdit(item)}>
                  {t('config.items.edit')}
                </Button>
                {confirming === item.name ? (
                  <>
                    <Button
                      variant="primary"
                      disabled={deletingName === item.name}
                      onClick={() => {
                        setConfirming(null);
                        onDelete(item.name);
                      }}
                    >
                      {deletingName === item.name ? t('config.items.deleting') : t('config.items.confirmDelete', { name: item.name })}
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirming(null)}>
                      {t('config.items.cancel')}
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setConfirming(item.name)}>
                    {t('config.items.delete')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
