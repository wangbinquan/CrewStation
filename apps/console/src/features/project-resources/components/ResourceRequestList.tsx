import { useState } from 'react';
import type { LegacyResourceRequest, ProjectResourceSnapshot, ResourceRequestDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { useApiMutation, errorMessage } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { DataTable } from '../../../shared/ui/DataTable';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { isInFlight } from '../model/workspace';
import styles from './ResourceCenter.module.css';

export function ResourceRequestList({ snapshot, onSelect, onLegacy }: { snapshot: ProjectResourceSnapshot; onSelect: (id: string) => void; onLegacy: (request: LegacyResourceRequest) => void }) {
  const t = useT(), [page, setPage] = useState<{ rows: ResourceRequestDto[]; next?: string | null }>({ rows: [] });
  const rows = [...new Map([...page.rows, ...snapshot.requests].map((r) => [r.id, r])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), next = page.next === undefined ? snapshot.requestsNextCursor : page.next;
  const load = useApiMutation(async (cursor: string) => api.resourceCenter.requests(snapshot.projectId, { cursor, limit: 100 }), { onSuccess: (result) => setPage((old) => ({ rows: [...old.rows, ...result.items], next: result.nextCursor })) });
  return <><DataTable columns={['resource', 'state', 'requester', 'reason', 'created', 'actions'].map((v) => t(`resourceCenter.${v}`))}>
    {snapshot.legacyRequests.map((request) => <tr key={`legacy:${request.id}`}><td>{request.name}<small className={styles.block}>{t('resourceCenter.legacy')}</small></td><td><Badge tone="warning">{t(`resourceCenter.requestState.${request.state}`)}</Badge></td><td>{request.requesterName ?? request.requestedBy}</td><td className={styles.reasonCell}>{request.reason}</td><td>{new Date(request.createdAt).toLocaleString()}</td><td><Button size="small" onClick={() => onLegacy(request)}>{t('resourceCenter.details')}</Button></td></tr>)}
    {rows.map((request) => <tr key={request.id}><td>{request.targetName}<small className={styles.block}>{t(`resourceCenter.origin.${request.origin}`)}</small></td><td><Badge tone={isInFlight(request.state) ? 'warning' : request.state === 'applied' ? 'success' : 'neutral'}>{t(`resourceCenter.requestState.${request.state}`)}</Badge>{request.failure ? <small className={styles.block}>{request.failure}</small> : null}</td><td>{request.requesterName ?? request.requestedBy}</td><td className={styles.reasonCell}>{request.reason}</td><td>{new Date(request.createdAt).toLocaleString()}</td><td><Button size="small" onClick={() => onSelect(request.id)}>{t('resourceCenter.details')}</Button></td></tr>)}
  </DataTable>{!rows.length && !snapshot.legacyRequests.length ? <p className={styles.empty}>{t('resourceCenter.noRequests')}</p> : null}{load.error ? <p role="alert">{errorMessage(load.error)}</p> : null}{next ? <Button disabled={load.isPending} onClick={() => load.mutate(next)}>{t('resourceCenter.more')}</Button> : null}</>;
}
