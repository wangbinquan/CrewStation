import type { ReactNode } from 'react';
import { Card } from '../../../../shared/ui/Card';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { useT } from '../../../../shared/lib/useT';

/** 待办是一张列表卡片：「查看全部」在卡片头右侧；数据每 30 秒自动重读，没有刷新按钮（2026-09-23 裁定）。 */
export function AdminTodoCard({ title, pending, error, count, more, open, children }: {
  readonly title: string; readonly pending: boolean; readonly error: unknown;
  readonly count?: number; readonly more: boolean; readonly open: ReactNode; readonly children: ReactNode;
}) {
  const t = useT();
  return <Card compact title={title} extra={open}
    footer={<span>{!pending && !error && count !== undefined ? t(more ? 'admin.todo.more' : 'admin.todo.count', { count }) : t('admin.todo.countUnknown')}</span>}>
    <QueryStatus isPending={pending} error={error} isEmpty={count === 0} emptyTitle={t('admin.todo.empty')} />
    {error && count ? <ActionNote tone="neutral">{t('admin.todo.lastRead')}</ActionNote> : null}
    {children}
  </Card>;
}
