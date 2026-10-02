import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ProjectDeletionOperation, ProjectDeletionPlan } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import { Stack } from '../../../shared/ui/Stack';
import { ConfirmDialog } from '../../../shared/ui/dialog/ConfirmDialog';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import { deletionPlanReady, deletionReviewRows } from '../model/deletionReview';

export interface ProjectDeletionDialogProps {
  project: { id: string; name: string; slug: string };
  plan?: ProjectDeletionPlan;
  operation?: ProjectDeletionOperation;
  loading?: boolean;
  error?: string;
  onRefresh(): void;
  /** Caller retains the server plan/request key and handles read/replay; the view never starts a new operation on a refresh. */
  onConfirm(plan: ProjectDeletionPlan): Promise<void>;
  onRetry?(): void;
  onClose(): void;
}

/** Two shared modal layers; mounted only by the administrator flow after all backend owners are available. */
export function ProjectDeletionDialog({ project, plan, operation, loading = false, error, onRefresh, onConfirm, onRetry, onClose }: ProjectDeletionDialogProps): ReactElement {
  const t = useT(), inFlight = useRef(false), active = useRef(true);
  const [confirmation, setConfirmation] = useState<string>(), [busy, setBusy] = useState(false), [localError, setLocalError] = useState<string>();
  const [now, refreshTime] = useState(() => Date.now());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!plan) return;
    const timer = setTimeout(() => refreshTime(Date.now()), Math.min(2_147_483_647, Math.max(0, Date.parse(plan.expiresAt) - Date.now())));
    return () => clearTimeout(timer);
  }, [plan]);
  const ready = !loading && deletionPlanReady(plan, project.id, now);
  const target = operation?.project ?? plan?.target ?? project;
  const confirm = async () => {
    if (inFlight.current || !plan || confirmation !== plan.id || !deletionPlanReady(plan, project.id)) return;
    inFlight.current = true; setBusy(true); setLocalError(undefined);
    try { await onConfirm(plan); }
    catch { if (active.current) setLocalError(t('projects.delete.failed')); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  return <>
    <Dialog title={t(operation ? 'projects.delete.progressTitle' : 'projects.delete.reviewTitle')} size="large" busy={busy} onClose={onClose}
      footer={<ActionRow>{!operation ? <><Button variant="danger" disabled={!ready || busy} onClick={() => { if (deletionPlanReady(plan, project.id)) setConfirmation(plan!.id); }}>{t('projects.delete.next')}</Button><Button variant="secondary" disabled={loading || busy} onClick={onRefresh}>{t('projects.delete.refresh')}</Button></> : operation.canRetry && onRetry ? <Button variant="primary" disabled={loading || busy} onClick={onRetry}>{t('projects.delete.retry')}</Button> : null}<Button variant="ghost" disabled={busy} onClick={onClose}>{t('projects.delete.close')}</Button></ActionRow>}>
      <Stack><DefinitionList layout="grid" items={[{ label: t('projects.delete.project'), value: target.name }, { label: t('projects.delete.slug'), value: target.slug }]} />
        {operation ? <DeletionProgress operation={operation} /> : <>
          <ActionNote tone="neutral">{t('projects.delete.consequence')}</ActionNote>
          {loading ? <ActionNote tone="neutral">{t('projects.delete.loading')}</ActionNote> : plan ? <DeletionInventory plan={plan} /> : null}
          {plan && !ready && !loading ? <ActionNote tone="error">{t(Date.parse(plan.expiresAt) <= now ? 'projects.delete.expired' : 'projects.delete.blocked')}</ActionNote> : null}
          <ActionNote tone="neutral">{t('projects.delete.shared')}</ActionNote>
        </>}
        {error || localError ? <ActionNote tone="error">{error ?? localError}</ActionNote> : null}
      </Stack>
    </Dialog>
    {!operation && plan && confirmation === plan.id ? <ConfirmDialog title={t('projects.delete.confirmTitle')} question={t('projects.delete.confirmQuestion', { name: target.name, slug: target.slug })}
      confirmWord="delete" confirmLabel={t('projects.delete.confirmTitle')} cancelLabel={t('projects.delete.back')} busy={busy} busyLabel={t('projects.delete.accepting')} confirmDisabled={!ready}
      onCancel={() => setConfirmation(undefined)} onConfirm={() => { void confirm(); }}>
      <p>{t('projects.delete.consequence')}</p><p>{t('projects.delete.irreversible')}</p>
      {error || localError ? <ActionNote tone="error">{error ?? localError}</ActionNote> : null}
    </ConfirmDialog> : null}
  </>;
}

function DeletionInventory({ plan }: { plan: ProjectDeletionPlan }): ReactElement {
  const t = useT();
  return <Stack><DataTable columns={[t('projects.delete.category'), t('projects.delete.items'), t('projects.delete.readiness')]}>
    {deletionReviewRows(plan).map((row) => <tr key={row.participant}><td>{t(`projects.delete.owner.${row.participant}`)}{row.resources.map((resource) => <p key={`${resource.kind}:${resource.id}`}><code>{resource.id}</code> · {resource.count}</p>)}</td><td>{row.count}</td><td><Badge tone={row.complete && !row.blockers.length && !row.references.length ? 'success' : 'danger'}>{t(row.complete && !row.blockers.length && !row.references.length ? 'projects.delete.ready' : 'projects.delete.blockedLabel')}</Badge>{row.blockers.map((blocker, index) => <p key={index}>{blocker.message}</p>)}{row.references.map((reference, index) => <p key={index}>{reference.description}</p>)}</td></tr>)}
  </DataTable>{plan.blockers.map((blocker, index) => <ActionNote key={index} tone="error">{blocker.message}</ActionNote>)}</Stack>;
}

function DeletionProgress({ operation }: { operation: ProjectDeletionOperation }): ReactElement {
  const t = useT();
  return <Stack><ActionNote tone={operation.state === 'succeeded' ? 'success' : operation.state === 'needs-attention' ? 'error' : 'neutral'}>{t(`projects.delete.state.${operation.state}`)}</ActionNote>
    <DefinitionList items={[{ label: t('projects.delete.stage'), value: t(`projects.delete.phase.${operation.phase}`) }, { label: t('projects.delete.operation'), value: operation.id }]} />
    {operation.blockers.map((blocker, index) => <ActionNote key={index} tone="error">{blocker.message}</ActionNote>)}
    {operation.state !== 'succeeded' ? <ActionNote tone="neutral">{t('projects.delete.background')}</ActionNote> : null}
  </Stack>;
}
