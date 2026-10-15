import { useState } from 'react';
import type { ProjectResourceSnapshot } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { statusTone } from '../../../shared/ui/topology/topologyModel';
import type { TopologyNode } from '../../../shared/ui/topology/topologyModel';
import type { DeploymentGraph, DeploymentObject } from '../model/deploymentGraph';
import { ResourceList } from './ResourceList';
import styles from './ResourceCenter.module.css';

export function RuntimeObjectList({ nodes }: { nodes: readonly TopologyNode[] }) {
  const t = useT(), [limit, setLimit] = useState(50), [selected, setSelected] = useState<TopologyNode>();
  return <><ul className={styles.relations}>{nodes.slice(0, limit).map((node) => <li key={node.id}><strong>{node.title}</strong><span>{node.subtitle}</span><Badge tone={statusTone(node.status)}>{node.statusText}</Badge><Button size="small" onClick={() => setSelected(node)}>{t('resourceCenter.details')}</Button></li>)}</ul>
    {nodes.length > limit ? <Button onClick={() => setLimit(limit + 50)}>{t('resourceCenter.more')} · {limit} / {nodes.length}</Button> : null}
    {selected ? <Dialog title={selected.title} onClose={() => setSelected(undefined)}><dl className={styles.facts}><dt>{t('resourceCenter.identifier')}</dt><dd>{selected.id}</dd>{selected.facts?.map(([name, value], index) => <div className={styles.factRow} key={`${name}:${index}`}><dt>{name}</dt><dd>{value}</dd></div>)}</dl></Dialog> : null}
  </>;
}

export function DeploymentObjectDialog({ object, graph, snapshot, onClose, onResource }: { object: DeploymentObject; graph: DeploymentGraph; snapshot: ProjectResourceSnapshot; onClose: () => void; onResource: (id: string) => void }) {
  const t = useT(), [tab, setTab] = useState('permissions'), [limit, setLimit] = useState(50);
  const relations = graph.relations.filter((edge) => edge.from === object.node.id || edge.to === object.node.id);
  const names = new Map([...graph.original.nodes.map((node) => [node.id, node.title] as const), ...snapshot.nodes.map((node) => [node.id, node.name] as const)]);
  return <Dialog title={object.node.title} size="large" onClose={onClose}>
    <p>{object.node.subtitle} · {object.node.statusText}</p>
    <div className={styles.tabs} role="tablist" aria-label={t('resourceCenter.deployment.objectTabs')}>
      {(['permissions', 'instances', 'relations'] as const).map((key) => <Button role="tab" key={key} aria-selected={tab === key} onClick={() => setTab(key)}>{t(`resourceCenter.deployment.${key}`, { count: object.members.length })}</Button>)}
    </div>
    <div hidden={tab !== 'permissions'} role="tabpanel"><p className={styles.muted}>{t('resourceCenter.deployment.permissionHint')}</p><ResourceList nodes={object.permissions} permissions usage={graph.usedIds} readOnly={snapshot.archived || snapshot.role === 'developer'} onSelect={onResource} /></div>
    <div hidden={tab !== 'instances'} role="tabpanel">{object.members.length ? <RuntimeObjectList nodes={object.members} /> : <p>{t('resourceCenter.deployment.declared')}</p>}</div>
    <div hidden={tab !== 'relations'} role="tabpanel"><p className={styles.muted}>{t('resourceCenter.deployment.relationsHint')}</p><ul className={styles.relations}>{relations.slice(0, limit).map((edge, index) => <li key={`${edge.sourceId}:${edge.targetId}:${index}`}><strong>{names.get(edge.sourceId) ?? edge.sourceId} → {names.get(edge.targetId) ?? edge.targetId}</strong><span>{edge.label ?? t(`topology.edge.${edge.kind}`)} · {t(`resourceCenter.evidence.${edge.evidence}`)}</span><small>{edge.sourceId} → {edge.targetId}</small></li>)}</ul>{relations.length > limit ? <Button onClick={() => setLimit(limit + 50)}>{t('resourceCenter.more')}</Button> : null}</div>
  </Dialog>;
}
