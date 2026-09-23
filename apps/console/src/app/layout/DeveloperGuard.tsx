import { Navigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { EmptyState } from '../../shared/ui/EmptyState';
import { QueryStatus } from '../../shared/ui/QueryStatus';
import { ButtonLink } from '../../shared/ui/navigation/ButtonLink';

export function DeveloperGuard({ children }: { readonly children: ReactNode }) {
  const t = useT(), { projectId } = useParams({ strict: false });
  const me = useApiQuery(queryKeys.me(), () => api.me.get(), { staleTimeMs: 0, refetchOnWindowFocus: true, refetchIntervalMs: 15000 });
  const [visitedUser, setVisitedUser] = useState<string>();
  const visited = !!me.data?.id && visitedUser === me.data.id;
  const membership = me.data?.memberships?.find((m) => m.projectId === projectId);
  const previewOnly = !!projectId && !!membership && me.data?.platformRole !== 'admin' && (me.data?.platformRole === 'user' || membership.role === 'tester');
  const allowed = !me.isPending && !me.error && !previewOnly && (me.data?.platformRole === 'developer' || me.data?.platformRole === 'admin');
  if (allowed && !visited) setVisitedUser(me.data!.id);
  if (!visited && !me.isPending && !me.error && previewOnly) return <Navigate to="/market" replace />;
  // 身份每 15 秒重读、读取失败自动重试，权限一旦恢复页面自己回来；这里不提供「重新检查」按钮（2026-09-23 裁定）。
  const notice = me.isPending || me.error ? <QueryStatus isPending={me.isPending} error={me.error} />
    : !allowed ? <EmptyState title={t('development.denied')} description={t(visited ? 'development.suspended' : 'development.deniedHint')}
      action={<ButtonLink to="/market">{t('nav.market')}</ButtonLink>} /> : null;
  // Preserve existing drafts across a failed identity refresh; first-time visitors never mount protected content.
  return <>{notice}<div key={me.data?.id} hidden={!allowed} inert={!allowed} style={allowed ? { display: 'contents' } : undefined}>{allowed || visited ? children : null}</div></>;
}
