import { Link, Navigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../../shared/api/client';
import { queryKeys } from '../../shared/api/queryKeys';
import { useApiQuery } from '../../shared/api/useApi';
import { useT } from '../../shared/lib/useT';
import { Button } from '../../shared/ui/Button';
import { EmptyState } from '../../shared/ui/EmptyState';
import { QueryStatus } from '../../shared/ui/QueryStatus';

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
  const notice = me.isPending || me.error ? <><QueryStatus isPending={me.isPending} error={me.error} />
    {me.error ? <Button onClick={() => void me.refetch()}>{t('admin.retryIdentity')}</Button> : null}</>
    : !allowed ? <EmptyState title={t('development.denied')} description={t(visited ? 'development.suspended' : 'development.deniedHint')}
      action={<><Link to="/market">{t('nav.market')}</Link><Button onClick={() => void me.refetch()}>{t('admin.retryIdentity')}</Button></>} /> : null;
  // Preserve existing drafts across a failed identity refresh; first-time visitors never mount protected content.
  return <>{notice}<div key={me.data?.id} hidden={!allowed} inert={!allowed} style={allowed ? { display: 'contents' } : undefined}>{allowed || visited ? children : null}</div></>;
}
