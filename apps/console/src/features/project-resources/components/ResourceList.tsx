import { useState } from 'react';
import type { ProjectResourceNode } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { DataTable } from '../../../shared/ui/DataTable';
import { metricLimit, metricLabel } from '../model/workspace';
import styles from './ResourceCenter.module.css';

export function ResourceList({ nodes, onSelect }: { nodes: ProjectResourceNode[]; onSelect: (id: string) => void }) {
  const [limit, setLimit] = useState(50), t = useT();
  return <><DataTable columns={['resource', 'access', 'quota', 'source', 'state', 'actions'].map((v) => t(`resourceCenter.${v}`))}>
    {nodes.slice(0, limit).map((node) => <tr key={node.id}><td><strong>{node.name}</strong><small className={styles.block}>{node.description || node.resourceType}</small></td><td><Badge tone={node.access === 'pending' ? 'warning' : node.access === 'requestable' ? 'info' : 'neutral'}>{t(`resourceCenter.access.${node.access}`)}</Badge>{node.pendingRequestIds.length > 0 && node.access !== 'pending' ? <small className={styles.block}>{t('resourceCenter.pending')} · {node.pendingRequestIds.length}</small> : null}</td><td>{node.metrics.length ? node.metrics.slice(0, 2).map((m) => <small className={styles.block} key={`${m.scopeId}:${m.key}`}>{metricLabel(m, t)} · {metricLimit(m, t)}</small>) : '—'}</td><td>{t(`resourceCenter.source.${node.source}`)}<small className={styles.block}>{t(`resourceCenter.environment.${node.environment}`)}</small></td><td><Badge tone={node.stale ? 'warning' : /failed/.test(node.state) ? 'danger' : 'neutral'}>{node.stale ? t('resourceCenter.stale') : node.stateText}</Badge></td><td><Button size="small" onClick={() => onSelect(node.id)}>{t('resourceCenter.details')}</Button></td></tr>)}
  </DataTable>{!nodes.length ? <p className={styles.empty}>{t('resourceCenter.empty')}</p> : null}{nodes.length > limit ? <Button onClick={() => setLimit(limit + 50)}>{t('resourceCenter.more')} · {limit} / {nodes.length}</Button> : null}</>;
}
