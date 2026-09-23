import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { EmptyState } from '../../shared/ui/EmptyState';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { Button } from '../../shared/ui/Button';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

/**
 * 管理空间的组件级守卫，三态（RFC-002 §2.2）：
 * - 加载中：只显示 pending，不闪内容也不闪拒绝页
 * - 请求失败：显示错误并可重试，**不当成「非管理员」**——把网络错误渲染成权限不足会误导排查
 * - 非管理员：拒绝页，说清这是哪儿、需要什么、怎么回去。不是 404：假装不存在会让真管理员无从下手
 *
 * 不用路由级 beforeLoad 重定向：/v1/me 是异步的，在 beforeLoad 里等它会让整个管理空间首屏阻塞，
 * 而重定向到 / 会把「我有权限但网络慢」表现成神秘跳转。
 */
export function AdminGuard({ children }: { readonly children: ReactNode }): ReactElement {
  const t = useT();
  const me = useApiQuery(queryKeys.me(), () => api.me.get(), { staleTimeMs: 0, refetchOnWindowFocus: true, refetchIntervalMs: 15000 });
  const [visitedUser, setVisitedUser] = useState<string>();
  const allowed = !me.isPending && !me.error && me.data?.platformRole === 'admin';
  const visited = !!me.data?.id && visitedUser === me.data.id;
  if (allowed && !visited) setVisitedUser(me.data!.id);
  const notice = me.isPending || me.error ? <><QueryStatus isPending={me.isPending} error={me.error} />
    {me.error ? <Button disabled={me.isFetching} onClick={() => void me.refetch({ cancelRefetch: false })}>{t('admin.retryIdentity')}</Button> : null}</>
    : !allowed ? (
      <EmptyState
        title={t('admin.denied.title')}
        description={t('admin.denied.description')}
        action={<ButtonLink to="/">{t('admin.denied.back')}</ButtonLink>}
      />
    ) : null;
  return <>{notice}<div key={me.data?.id} hidden={!allowed} inert={!allowed} style={allowed ? { display: 'contents' } : undefined}>{allowed || visited && !!me.error ? children : null}</div></>;
}
