import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Card } from '../../../shared/ui/Card';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { useLogFeed } from '../hooks/useLogFeed';
import { LogList } from './LogList';

const noop = () => {};
/** 开发会话面板里内嵌的最近日志（RFC-020 §4.3）：固定读当前会话的尾部，跟随刷新；完整筛选去运行与诊断。 */
export function LogTail({ projectId, taskId, more }: { readonly projectId: string; readonly taskId: string; readonly more?: ReactNode }): ReactElement {
  const t = useT();
  const feed = useLogFeed(projectId, { tab: 'logs', source: 'dev-session', taskId, limit: 200 }, noop);
  return <Card compact title={t('logs.tail.title')} extra={more} footer={t('logs.tail.hint')}>
    <QueryStatus isPending={feed.isPending} error={feed.error} isEmpty={!feed.isPending && !feed.error && feed.entries.length === 0} emptyTitle={t('logs.list.emptyTitle')} emptyDescription={t('logs.list.emptyDescription')} />
    {feed.entries.length > 0 ? <LogList entries={feed.entries} follow={feed.follow} /> : null}
  </Card>;
}
