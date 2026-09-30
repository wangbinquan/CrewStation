import { useMemo, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import type { LegacyResourceRequest, ResourceActionDescriptor } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useViewportFill } from '../../../shared/lib/useViewportFill';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { TopologyDiagram } from '../../../shared/ui/topology/TopologyDiagram';
import { TopologyList } from '../../../shared/ui/topology/TopologyList';
import { useNarrow } from '../../../shared/ui/topology/TopologyWorkspace';
import { FULL_METRICS } from '../../../shared/ui/topology/topologyLayout';
import { useResourceCenter } from '../model/useResourceCenter';
import { resourceTopology, filterResourceTopology } from '../model/topology';
import { initialDraft, matches, parseCenterSearch, isInFlight } from '../model/workspace';
import type { CenterSearch, ResourceDraft } from '../model/workspace';
import { ResourceList } from '../components/ResourceList';
import { ResourceRequestList } from '../components/ResourceRequestList';
import { ResourceDetailDialog } from '../components/ResourceDetailDialog';
import { ResourceActionDialog } from '../components/ResourceActionDialog';
import { ResourceRequestDialog } from '../components/ResourceRequestDialog';
import { LegacyRequestDialog } from '../components/LegacyRequestDialog';
import { ResourceBindingRevokeDialog } from '../components/ResourceBindingRevokeDialog';
import styles from '../components/ResourceCenter.module.css';

const metrics = { ...FULL_METRICS, nodeH: 90, laneGap: 38, rowGap: 18 };
export function ProjectResourceCenterView({ projectId, management }: { projectId: string; management?: ReactNode }) {
  const t = useT(), navigate = useNavigate(), search = parseCenterSearch(useSearch({ strict: false })), view = search.view ?? 'topology';
  const query = useResourceCenter(projectId), me = useApiQuery(queryKeys.me(), () => api.me.get()), narrow = useNarrow();
  const [revokeBinding, setRevokeBinding] = useState<string>();
  const page = useRef<HTMLDivElement>(null); useViewportFill(page);
  const [action, setAction] = useState<{ name: string; descriptor: ResourceActionDescriptor }>(), [drafts, setDrafts] = useState<Record<string, ResourceDraft>>({}), [expanded, setExpanded] = useState(false), [memberId, setMemberId] = useState<string>(), [legacy, setLegacy] = useState<LegacyResourceRequest>(), [legacyReasons, setLegacyReasons] = useState<Record<string, string>>({}), [notice, setNotice] = useState('');
  const snapshot = [401, 403, 404].includes(query.error?.status ?? 0) ? undefined : query.data;
  const graph = useMemo(() => snapshot ? resourceTopology(snapshot, t) : undefined, [snapshot, t]);
  const patch = (change: Partial<CenterSearch>) => { void navigate({ to: '.', search: (previous) => ({ ...previous, ...change }), replace: true, resetScroll: false }); };
  const selected = graph?.displayed.get(search.node ?? '') ?? snapshot?.nodes.find((n) => n.id === search.node), member = snapshot?.nodes.find((n) => n.id === memberId);
  const initialRequest = snapshot?.requests.find((r) => r.id === search.request);
  const oldRequest = useApiQuery(['selected-resource-request', projectId, search.request], () => api.resourceCenter.request(projectId, search.request!), { enabled: !!search.request && !initialRequest && !!snapshot });
  const request = initialRequest ?? (search.request ? oldRequest.data : undefined);
  const openAction = (name: string, descriptor: ResourceActionDescriptor) => { if (!drafts[descriptor.id]) setDrafts((old) => ({ ...old, [descriptor.id]: initialDraft(descriptor.current ?? {}) })); setAction({ name, descriptor }); };
  const updateDraft = (key: string, draft: ResourceDraft) => setDrafts((old) => ({ ...old, [key]: draft }));
  const openRequest = (id: string) => { const old = snapshot?.legacyRequests.find((r) => r.id === id); if (old) setLegacy(old); else patch({ request: id }); };
  const requestDraft = request ? drafts[`request:${request.id}`] ?? initialDraft(request.approvedValues ?? request.requestedValues) : undefined;
  const visible = snapshot?.nodes.filter((node) => matches(node, search)) ?? [], matchingIds = new Set(visible.map((n) => n.id));
  const filtered = graph && (search.category || search.q || search.access) ? filterResourceTopology(graph, matchingIds) : undefined;
  const topology = filtered ?? graph?.topology;
  return <div className={styles.page} ref={page}>
    <QueryStatus isPending={query.isPending} error={query.error} />
    {snapshot && graph && topology ? <>
      <div className={styles.summary}><div><strong>{snapshot.projectName}</strong><small>{snapshot.namespace} · {t(`resourceCenter.role.${snapshot.role}`)}</small></div>{(['owned', 'requestable', 'pending'] as const).map((access) => <button type="button" key={access} className={styles.stat} aria-pressed={search.access === access} onClick={() => patch({ access: search.access === access ? undefined : access })}><span>{t(`resourceCenter.access.${access}`)}</span><strong>{access === 'pending' ? snapshot.requests.filter((r) => isInFlight(r.state)).length + snapshot.legacyRequests.length : snapshot.nodes.filter((n) => n.access === access && n.kind !== 'request' && n.kind !== 'group').length}</strong></button>)}</div>
      <div className={styles.toolbar}><div className={styles.tabs} role="tablist" aria-label={t('resourceCenter.views')}>{(['topology', 'list', 'requests'] as const).map((tab) => <Button size="small" variant="ghost" role="tab" key={tab} aria-selected={view === tab} onClick={() => patch({ view: tab })}>{t(`resourceCenter.view.${tab}`)}</Button>)}</div><div className={styles.controls}><input type="search" aria-label={t('resourceCenter.search')} placeholder={t('resourceCenter.search')} value={search.q ?? ''} onChange={(event) => patch({ q: event.target.value || undefined })} /><select aria-label={t('resourceCenter.category')} value={search.category ?? ''} onChange={(event) => patch({ category: event.target.value || undefined })}><option value="">{t('resourceCenter.allCategories')}</option>{['foundation', 'service', 'execution', 'data', 'integration'].map((category) => <option key={category} value={category}>{t(`resourceCenter.category.${category}`)}</option>)}</select><select aria-label={t('resourceCenter.access')} value={search.access ?? ''} onChange={(event) => patch({ access: event.target.value || undefined })}><option value="">{t('resourceCenter.allAccess')}</option>{['owned', 'requestable', 'pending', 'unavailable'].map((access) => <option key={access} value={access}>{t(`resourceCenter.access.${access}`)}</option>)}</select>{snapshot.role === 'admin' ? management : null}{view === 'topology' && !narrow ? <Button size="small" onClick={() => setExpanded(true)}>{t('resourceCenter.expand')}</Button> : null}</div></div>
      {snapshot.role === 'developer' || snapshot.archived ? <p className={styles.note}>{t(snapshot.archived ? 'resourceCenter.archived' : 'resourceCenter.developerHint')}</p> : null}
      {notice ? <p className={styles.note} role="status">{notice}</p> : null}
      {!snapshot.complete ? <details className={styles.warning}><summary>{t('resourceCenter.partial')}</summary>{snapshot.sources.filter((s) => !s.complete).map((s) => <p key={s.id}>{s.name}: {s.error}</p>)}</details> : null}
      <div className={styles.stage} role="tabpanel">
        {view === 'topology' && !narrow ? <TopologyDiagram topology={topology} metrics={metrics} label={t('resourceCenter.title')} selectedId={search.node} onSelect={(id) => patch({ node: id })} /> : view === 'requests' ? <ResourceRequestList snapshot={snapshot} onSelect={openRequest} onLegacy={setLegacy} /> : <ResourceList nodes={visible} onSelect={(id) => patch({ node: id })} />}
      </div>
      <div className={styles.footer}><div className={styles.legend}>{['configured', 'observed', 'proposed'].map((evidence) => <span key={evidence} data-evidence={evidence}><i />{t(`resourceCenter.evidence.${evidence}`)}</span>)}</div><small>{t('resourceCenter.observed')} · {new Date(snapshot.observedAt).toLocaleString()} · {t('resourceCenter.autoRefresh')}</small><details><summary>{t('resourceCenter.sources')} · {snapshot.sources.length}</summary>{snapshot.sources.map((source) => <p key={source.id}><Badge tone={source.complete ? 'success' : 'warning'}>{source.complete ? t('resourceCenter.complete') : t('resourceCenter.partialShort')}</Badge> {source.name} · {source.observedAt ? new Date(source.observedAt).toLocaleTimeString() : '—'} {source.error}</p>)}</details></div>
      {expanded ? <Dialog title={t('resourceCenter.title')} size="fullscreen" onClose={() => setExpanded(false)}>{narrow ? <TopologyList topology={topology} onSelect={(id) => patch({ node: id })} /> : <TopologyDiagram topology={topology} metrics={metrics} label={t('resourceCenter.title')} onSelect={(id) => patch({ node: id })} />}</Dialog> : null}
      {selected ? <ResourceDetailDialog node={selected} snapshot={snapshot} members={graph.groups.get(selected.id)} onClose={() => { setMemberId(undefined); patch({ node: undefined }); }} onMember={setMemberId} onAction={(descriptor) => openAction(selected.name, descriptor)} onRequest={openRequest} onRevokeBinding={setRevokeBinding} /> : null}
      {member ? <ResourceDetailDialog node={member} snapshot={snapshot} onClose={() => setMemberId(undefined)} onMember={setMemberId} onAction={(descriptor) => openAction(member.name, descriptor)} onRequest={openRequest} onRevokeBinding={setRevokeBinding} /> : null}
      {action && drafts[action.descriptor.id] ? <ResourceActionDialog key={action.descriptor.id} projectId={projectId} name={action.name} action={action.descriptor} draft={drafts[action.descriptor.id]!} onDraft={(draft) => updateDraft(action.descriptor.id, draft)} onClose={() => setAction(undefined)} onDone={(id) => { setDrafts((old) => { const next = { ...old }; delete next[action.descriptor.id]; return next; }); setAction(undefined); setNotice(t(id ? 'resourceCenter.submitted' : 'resourceCenter.policySaved')); if (id) openRequest(id); }} /> : null}
      {request && requestDraft ? <ResourceRequestDialog key={request.id} projectId={projectId} initial={request} role={snapshot.role} viewerId={me.data?.id} archived={snapshot.archived} draft={requestDraft} onDraft={(draft) => updateDraft(`request:${request.id}`, draft)} onClose={() => patch({ request: undefined })} onDone={() => setNotice(t('resourceCenter.recorded'))} /> : null}
      {search.request && !request ? <Dialog title={t('resourceCenter.requestDetails')} onClose={() => patch({ request: undefined })}><QueryStatus isPending={oldRequest.isPending} error={oldRequest.error} /></Dialog> : null}
      {legacy ? <LegacyRequestDialog projectId={projectId} request={legacy} reason={legacyReasons[legacy.id] ?? ''} onReason={(reason) => setLegacyReasons((old) => ({ ...old, [legacy.id]: reason }))} onClose={() => setLegacy(undefined)} /> : null}
      {revokeBinding ? <ResourceBindingRevokeDialog projectId={projectId} bindingId={revokeBinding} reason={legacyReasons[`revoke:${revokeBinding}`] ?? ''} onReason={(reason) => setLegacyReasons((old) => ({ ...old, [`revoke:${revokeBinding}`]: reason }))} onClose={() => setRevokeBinding(undefined)} /> : null}
    </> : null}
  </div>;
}
