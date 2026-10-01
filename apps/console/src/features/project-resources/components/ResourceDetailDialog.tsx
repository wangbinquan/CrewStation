import type { ProjectResourceNode, ProjectResourceSnapshot, ResourceActionDescriptor } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { ResourceMetrics } from './ResourceMetrics';
import { ResourceList } from './ResourceList';
import { actionLabel, label } from '../model/workspace';
import { resourceGroupSummary } from '../model/topology';
import styles from './ResourceCenter.module.css';

export function ResourceDetailDialog({ node, members, snapshot, onClose, onMember, onAction, onRequest, onRevokeBinding }: { node: ProjectResourceNode; members?: ProjectResourceNode[]; snapshot: ProjectResourceSnapshot; onClose: () => void; onMember: (id: string) => void; onAction: (action: ResourceActionDescriptor) => void; onRequest: (id: string) => void; onRevokeBinding: (id: string) => void }) {
  const t = useT(), edges = snapshot.edges.filter((e) => e.sourceId === node.id || e.targetId === node.id), names = new Map(snapshot.nodes.map((n) => [n.id, n.name])), summary = members ? resourceGroupSummary(members) : undefined;
  return <Dialog title={node.name} size="large" onClose={onClose} footer={<ActionRow><Button variant="ghost" onClick={onClose}>{t('resourceCenter.close')}</Button></ActionRow>}>
    <div className={styles.inline}>{summary ? <><Badge>{t('resourceCenter.access.owned')} · {summary.owned}</Badge><Badge tone="info">{t('resourceCenter.access.requestable')} · {summary.requestable}</Badge><Badge tone="warning">{t('resourceCenter.pending')} · {summary.pendingRequestIds.length}</Badge>{summary.unavailable ? <Badge>{t('resourceCenter.access.unavailable')} · {summary.unavailable}</Badge> : null}</> : <><Badge tone={node.access === 'pending' ? 'warning' : node.access === 'requestable' ? 'info' : 'neutral'}>{t(`resourceCenter.access.${node.access}`)}</Badge><Badge>{t(`resourceCenter.source.${node.source}`)}</Badge><Badge>{t(`resourceCenter.environment.${node.environment}`)}</Badge></>}{node.stale ? <Badge tone="warning">{t('resourceCenter.stale')}</Badge> : null}</div>
    {node.description ? <p>{node.description}</p> : null}
    {members ? <ResourceList key={node.id} nodes={members} permissions readOnly={snapshot.role === 'developer' || snapshot.archived} onSelect={onMember} /> : <>
      <ActionRow>{node.actions.map((action) => <Button key={action.id} variant={action.target?.action === 'revoke' ? 'danger' : 'secondary'} disabled={!action.enabled || snapshot.archived} title={action.reason} onClick={() => onAction(action)}>{actionLabel(action, t)}</Button>)}</ActionRow>
      {node.actions.filter((a) => !a.enabled && a.reason).map((a) => <small className={styles.block} key={a.id}>{a.reason}</small>)}
      <ResourceMetrics metrics={node.metrics} />
      {snapshot.role === 'admin' && !snapshot.archived && node.resourceType === 'data-binding' && node.environment === 'production' && node.state === 'active' && node.resourceId ? <Button variant="danger" onClick={() => onRevokeBinding(node.resourceId!)}>{t('resourceCenter.revokeBinding')}</Button> : null}
      <dl className={styles.facts}><dt>{t('resourceCenter.identifier')}</dt><dd><code>{node.resourceId ?? node.id}</code></dd><dt>{t('resourceCenter.state')}</dt><dd>{node.stateText}</dd><dt>{t('resourceCenter.observed')}</dt><dd>{node.observedAt ? new Date(node.observedAt).toLocaleString() : t('resourceCenter.notObserved')}</dd>{node.facts.map((fact) => <div className={styles.factRow} key={fact.label}><dt>{label(t, `fact.${fact.label}`, fact.label)}</dt><dd>{fact.value}</dd></div>)}</dl>
      {edges.length ? <><h3>{t('resourceCenter.relationships')}</h3><ul className={styles.relations}>{edges.map((edge) => <li key={edge.id}><span>{names.get(edge.sourceId)} → {names.get(edge.targetId)}</span><small>{t(`resourceCenter.relation.${edge.relation}`)} · {t(`resourceCenter.evidence.${edge.state}`)}</small></li>)}</ul></> : null}
    </>}
    {!members && node.pendingRequestIds.length ? <><h3>{t('resourceCenter.pending')}</h3><ActionRow>{node.pendingRequestIds.map((id) => <Button key={id} size="small" onClick={() => onRequest(id)}>{t('resourceCenter.viewRequest')} · {id.slice(-8)}</Button>)}</ActionRow></> : null}
  </Dialog>;
}
