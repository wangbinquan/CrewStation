import type { ReactNode } from 'react';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import styles from './AdminTodos.module.css';

export function AdminTodoCard({ title, refreshLabel, pending, error, busy, count, more, checkedAt, refresh, open, children }: {
  readonly title: string; readonly refreshLabel: string; readonly pending: boolean; readonly error: unknown; readonly busy: boolean;
  readonly count?: number; readonly more: boolean; readonly checkedAt: number; readonly refresh: () => Promise<unknown>;
  readonly open: ReactNode; readonly children: ReactNode;
}) {
  const t = useT(), date = useDateText();
  return <Card compact title={title} extra={<Button disabled={busy} onClick={() => void refresh()}>{refreshLabel}</Button>}
    footer={<div className={styles.footer}><span>{!pending && !error && count !== undefined ? t(more ? 'admin.todo.more' : 'admin.todo.count', { count }) : t('admin.todo.countUnknown')}</span>{open}</div>}>
    <QueryStatus isPending={pending} error={error} isEmpty={count === 0} emptyTitle={t('admin.todo.empty')} />
    {error && count ? <ActionNote tone="neutral">{t('admin.todo.lastRead')}</ActionNote> : null}
    {children}{checkedAt > 0 ? <small className={styles.muted}>{t('admin.todo.checked', { time: date(new Date(checkedAt).toISOString()) })}</small> : null}
  </Card>;
}
