import { useMemo, useState } from 'react';
import type { ProjectResourceSnapshot } from '@crewstation/contracts';
import type { useProjectTopology } from '../../../shared/topology/useProjectTopology';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { TopologyDiagram } from '../../../shared/ui/topology/TopologyDiagram';
import { TopologyList } from '../../../shared/ui/topology/TopologyList';
import { useNarrow } from '../../../shared/ui/topology/TopologyWorkspace';
import { FULL_METRICS } from '../../../shared/ui/topology/topologyLayout';
import { DEPLOYMENT_VIEWS } from '../model/deploymentGraph';
import type { DeploymentGraph } from '../model/deploymentGraph';
import { deploymentProjection } from '../model/deploymentProjection';
import type { CenterSearch } from '../model/workspace';
import { DeploymentObjectDialog, RuntimeObjectList } from './DeploymentObjectDialog';
import { DeploymentQuota } from './DeploymentQuota';
import styles from './ResourceCenter.module.css';

const metrics = { ...FULL_METRICS, nodeW: 210, nodeH: 96, laneGap: 48, rowGap: 48, bandTitle: 12, bandPad: 14, laneHeader: 28 };
export function DeploymentWorkspace({ graph, facts, snapshot, search, patch, onResource }: { graph?: DeploymentGraph; facts: ReturnType<typeof useProjectTopology>; snapshot: ProjectResourceSnapshot; search: CenterSearch; patch: (next: Partial<CenterSearch>) => void; onResource: (id: string) => void }) {
  const t = useT(), narrow = useNarrow(800), [expanded, setExpanded] = useState(false), [unmapped, setUnmapped] = useState(false);
  const perspective = search.perspective ?? 'services';
  const projection = useMemo(() => graph ? deploymentProjection(graph, perspective, search, t) : undefined, [graph, perspective, search, t]);
  const selected = graph?.objects.get(search.node ?? '');
  const select = (id: string | undefined) => patch({ node: id });
  const diagram = projection ? narrow ? <TopologyList topology={projection.topology} selectedId={search.node} onSelect={select} /> : <TopologyDiagram key={perspective} topology={projection.topology} metrics={metrics} label={t('resourceCenter.deployment.title')} selectedId={search.node} onSelect={select} /> : null;
  return <div className={styles.deployment}>
    <DeploymentQuota snapshot={snapshot} onOpen={() => patch({ node: 'group:namespace' })} />
    <div className={styles.toolbar}><div className={styles.tabs} role="tablist" aria-label={t('resourceCenter.deployment.perspectives')}>{DEPLOYMENT_VIEWS.map((view) => <Button size="small" key={view} role="tab" aria-selected={perspective === view} onClick={() => patch({ perspective: view, page: undefined, node: undefined })}>{t(`resourceCenter.deployment.view.${view}`)}</Button>)}</div><Button size="small" disabled={!projection} onClick={() => setExpanded(true)}>{t('resourceCenter.expand')}</Button></div>
    <p className={styles.muted}>{t('resourceCenter.deployment.graphHint')}</p>
    <QueryStatus isPending={facts.isPending} error={facts.error} />
    {projection && !projection.topology.complete ? <p className={styles.warning}>{t('resourceCenter.partial')} · {projection.topology.incompleteReason}</p> : null}
    <div className={styles.deploymentStage}>{projection?.count === 0 ? <p className={styles.empty}>{t(facts.topology?.complete ? 'resourceCenter.deployment.empty' : 'resourceCenter.deployment.unknown')}</p> : diagram}</div>
    {projection && projection.pages > 1 ? <div className={styles.controls}><Button size="small" disabled={projection.page === 1} onClick={() => patch({ page: projection.page - 1 })}>{t('resourceCenter.deployment.previous')}</Button><span>{t('resourceCenter.deployment.pageCount', { page: projection.page, pages: projection.pages, count: projection.count })}</span><Button size="small" disabled={projection.page === projection.pages} onClick={() => patch({ page: projection.page + 1 })}>{t('resourceCenter.deployment.next')}</Button></div> : null}
    <div className={styles.controls}><Button onClick={() => patch({ node: 'group:project' })}>{t('resourceCenter.deployment.project')}</Button><Button onClick={() => patch({ view: 'list' })}>{t('resourceCenter.deployment.catalog')}</Button><Button disabled={!graph} onClick={() => setUnmapped(true)}>{t('resourceCenter.deployment.unmapped')} · {graph?.unmapped.length ?? '—'}</Button></div>
    <details className={styles.sources}><summary>{t('resourceCenter.deployment.sources')}</summary>{facts.sources.map((source) => <p key={source.id}>{source.name} · {t(source.complete ? 'resourceCenter.complete' : 'resourceCenter.partialShort')} · {source.observedAt ? new Date(source.observedAt).toLocaleString() : t('resourceCenter.notObserved')} {source.error}</p>)}</details>
    {expanded ? <Dialog title={t('resourceCenter.deployment.title')} size="fullscreen" onClose={() => setExpanded(false)}>{diagram}</Dialog> : null}
    {unmapped && graph ? <Dialog title={t('resourceCenter.deployment.unmapped')} size="large" onClose={() => setUnmapped(false)}><p>{t('resourceCenter.deployment.unmappedHint')}</p><RuntimeObjectList nodes={graph.unmapped} /></Dialog> : null}
    {selected && graph ? <DeploymentObjectDialog key={selected.node.id} object={selected} graph={graph} snapshot={snapshot} onClose={() => patch({ node: undefined })} onResource={onResource} /> : null}
  </div>;
}
