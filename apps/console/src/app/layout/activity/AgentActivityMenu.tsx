import { useParams, useNavigate, useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useAgentActivity } from '../../../shared/activity/AgentActivityProvider';
import { activityCounts, taskEntries } from '../../../shared/activity/agentActivityView';
import type { ActivityEntry } from '../../../shared/activity/agentActivityView';
import type { ActivityTask } from '../../../shared/activity/agentActivityStore';
import { api } from '../../../shared/api/client';
import { queryKeys } from '../../../shared/api/queryKeys';
import { useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { useDateText } from '../../../shared/lib/useDateText';
import { Button } from '../../../shared/ui/Button';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import type { ProjectSpace } from '../../../shared/project/projectPaths';
import styles from './AgentActivityMenu.module.css';

export function AgentActivityMenu(): ReactElement {
  const { store, snapshot } = useAgentActivity(); const t = useT();
  const { projectId: routeProjectId } = useParams({ strict: false });
  const me = useApiQuery(queryKeys.me(), () => api.me.get()), pathname = useLocation().pathname;
  const isAdmin = !me.error && me.data?.isAdmin === true;
  const canView = !me.error && (isAdmin || me.data?.memberships?.some((member) => member.projectId === routeProjectId && ['owner', 'developer'].includes(member.role)));
  const projectId = canView && (pathname.startsWith('/projects/') || pathname.startsWith('/admin/integrations/') && isAdmin) ? routeProjectId : undefined;
  const session = useApiQuery(queryKeys.devSession(projectId ?? ''), () => api.devSession.get(projectId!), { enabled: Boolean(projectId && store), refetchIntervalMs: 10000 });
  const project = useApiQuery(queryKeys.project(projectId ?? ''), () => api.projects.get(projectId!), { enabled: Boolean(projectId && store) });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = (focus = true) => { setOpen(false); for (const task of snapshot.tasks) store?.resetOlder(task.taskId); if (focus) root.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus(); };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) { setOpen(false); for (const task of store?.getSnapshot().tasks ?? []) store?.resetOlder(task.taskId); } };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open, store]);
  const space = project.data?.kind === 'APIProxy' || project.data?.kind === 'EventProducer' ? 'admin' : 'workbench';
  useEffect(() => { if (store && projectId && session.data?.taskId && !session.error) store.register(session.data.taskId, projectId, project.data?.name ?? projectId, space); }, [store, projectId, project.data?.name, space, session.data, session.error]);
  useEffect(() => { if (!snapshot.notice || !store) return; const id = snapshot.notice.id, timer = setTimeout(() => store.dismissNotice(id), 7000); return () => clearTimeout(timer); }, [snapshot.notice, store]);
  const counts = snapshot.tasks.reduce((total, task) => { const counts = activityCounts(task); return { pending: total.pending + counts.pending, completions: total.completions + counts.completions }; }, { pending: 0, completions: 0 });
  // Escape 在整个入口区域生效：焦点停在按钮上（打开后未进入面板）时也能关闭并留在按钮。
  return <div className={styles.root} ref={root} onKeyDown={(event) => { if (open && event.key === 'Escape') { event.preventDefault(); close(); } }}>
    <Button aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>{t('activity.title')}{counts.pending ? <b className={styles.warning}>{t('activity.pendingCount', { count: counts.pending })}</b> : null}{counts.completions ? <b className={styles.success}>{t('activity.completedCount', { count: counts.completions })}</b> : null}</Button>
    {snapshot.notice ? <div className={styles.toast} role="status" aria-live="polite"><span>{t('activity.new', { count: snapshot.notice.count })}</span><Button onClick={() => { setOpen(true); store?.dismissNotice(snapshot.notice!.id); }}>{t('activity.show')}</Button></div> : null}
    {open ? <section className={styles.panel} aria-label={t('activity.title')}>
      <header><strong>{t('activity.title')}</strong><Button onClick={() => close()}>{t('activity.close')}</Button></header>
      <p className={styles.hint}>{t('activity.readHint')}</p>
      {snapshot.limited ? <p role="status">{t('activity.limit')}</p> : null}
      {snapshot.tasks.length === 0 ? <p>{t('activity.empty')}</p> : snapshot.tasks.map((task) => <ActivityTaskSection key={task.taskId} task={task} onNavigate={() => close(false)} />)}
    </section> : null}
  </div>;
}

function ActivityTaskSection({ task, onNavigate }: { readonly task: ActivityTask; readonly onNavigate: () => void }): ReactElement {
  const { store } = useAgentActivity(); const t = useT();
  const [offset, setOffset] = useState(0);
  const entries = taskEntries(task), page = task.older ?? task.page;
  const start = Math.min(offset, Math.max(0, Math.floor((entries.length - 1) / 50) * 50));
  return <section className={styles.task}>
    <header><strong>{task.name}</strong><Button variant="ghost" onClick={() => { store?.resetOlder(task.taskId); void store?.refresh(task.taskId); }}>{t('activity.refresh')}</Button></header>
    {task.loading ? <p role="status">{t('activity.loading')}</p> : null}
    {task.error || task.stale || task.page?.sync !== 'ready' || task.page.connection !== 'connected' ? <p className={styles.warning} role="status">{t(task.page?.sync === 'catching-up' ? 'activity.syncing' : 'activity.stale')}</p> : null}
    {task.page?.historyTruncated ? <small>{t('activity.truncated')}</small> : null}
    {!task.loading && entries.length === 0 ? <p>{t('activity.caughtUp')}</p> : null}
    {entries.slice(start, start + 50).map((entry) => <ActivityEntryRow key={entry.target.eventId} entry={entry} space={task.space ?? 'workbench'} onNavigate={onNavigate} />)}
    <footer>
      {start > 0 ? <Button onClick={() => setOffset(start - 50)}>{t('activity.previous')}</Button> : null}
      {start + 50 < entries.length ? <Button onClick={() => setOffset(start + 50)}>{t('activity.next')}</Button> : null}
      {page?.previousCursor !== undefined ? <Button disabled={task.olderLoading} onClick={() => { setOffset(0); void store?.older(task.taskId, page.previousCursor); }}>{t('activity.older')}</Button> : null}
      {task.older ? <Button onClick={() => store?.resetOlder(task.taskId)}>{t('activity.latest')}</Button> : null}
      {Boolean(task.terminals?.items.length) && task.terminals?.items.every((terminal) => terminal.lifecycle === 'ended') && task.page?.states.every((state) => state.processEnded) && !activityCounts(task).pending && !activityCounts(task).completions ? <Button onClick={() => store?.forget(task.taskId)}>{t('activity.removeEnded')}</Button> : null}
    </footer>
  </section>;
}

function ActivityEntryRow({ entry, space, onNavigate }: { readonly entry: ActivityEntry; readonly space: ProjectSpace; readonly onNavigate: () => void }): ReactElement {
  const t = useT(), dateText = useDateText(), navigate = useNavigate();
  const { target } = entry;
  return <div className={styles.entry} data-urgent={entry.kind === 'request-opened' || entry.kind === 'process-failed'}>
    <div><strong>CLI {target.agentId.slice(-6)}</strong><span>{t(entry.runtimeFailure ? 'activity.status.runtime-failed' : entry.requestKind ? `activity.request.${entry.requestKind}` : `activity.event.${entry.kind}`)}</span>{entry.unread ? <b className={styles.dot} aria-label={t('activity.unread')}>●</b> : null}<time dateTime={entry.at}>{dateText(entry.at)}</time></div>
    {entry.uncertain ? <small className={styles.warning}>{t('activity.lastKnown')}</small> : null}
    {entry.error ? <small>{entry.error}</small> : null}
    <Button onClick={() => { void navigate({ to: PROJECT_PATHS[space].development, params: { projectId: target.projectId }, search: { task: target.taskId, agent: target.agentId, terminal: target.terminalId, ...(target.turnId ? { turn: target.turnId } : {}), event: target.eventId, seq: target.seq, focus: crypto.randomUUID() } }); onNavigate(); }}>{t(entry.kind === 'request-opened' || entry.kind === 'process-failed' ? 'activity.handle' : 'activity.result')}</Button>
  </div>;
}
