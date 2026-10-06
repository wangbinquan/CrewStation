import { useEffect, useRef, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
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
  pending?: boolean;
  error?: string;
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Caller retains the server plan/request key; automatic progress reads never start a deletion. */
  onConfirm(plan: ProjectDeletionPlan): Promise<void>;
  onRetry?(): void;
  onRecover?(): void;
  onReview?(): void;
  onRepair?(): void;
  onClose(): void;
}

/** Two shared modal layers; mounted only by the administrator flow after all backend owners are available. */
export function ProjectDeletionDialog({ project, plan, operation, loading = false, pending = false, error, returnFocusTo, onConfirm, onRetry, onRecover, onReview, onRepair, onClose }: ProjectDeletionDialogProps): ReactElement {
  const t = useT(), inFlight = useRef(false), active = useRef(true);
  const [confirmation, setConfirmation] = useState<string>(), [busy, setBusy] = useState(false), [localError, setLocalError] = useState<string>();
  const [now, refreshTime] = useState(() => Date.now());
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!plan) return;
    const timer = setTimeout(() => refreshTime(Date.now()), Math.min(2_147_483_647, Math.max(0, Date.parse(plan.expiresAt) - Date.now())));
    return () => clearTimeout(timer);
  }, [plan]);
  const reviewing = !operation || !!plan;
  const sameOperation = operation ? operation.state === 'needs-attention' && plan?.operationId === operation.id && plan.supersedes === operation.confirmationDigest : !plan?.operationId;
  const ready = !loading && !pending && sameOperation && deletionPlanReady(plan, project.id, now);
  const closingLocked = busy || pending && loading;
  const target = operation?.project ?? plan?.target ?? project;
  const confirm = async () => {
    if (inFlight.current || loading || pending || !sameOperation || !plan || confirmation !== plan.id || !deletionPlanReady(plan, project.id)) return;
    inFlight.current = true; setBusy(true); setLocalError(undefined);
    try { await onConfirm(plan); }
    catch { if (active.current) setLocalError(t('projects.delete.failed')); }
    finally { inFlight.current = false; if (active.current) setBusy(false); }
  };
  return <>
    <Dialog title={t(reviewing && !pending ? 'projects.delete.reviewTitle' : 'projects.delete.progressTitle')} size="large" busy={closingLocked} onClose={onClose} returnFocusTo={returnFocusTo}
      footer={<ActionRow>
        {pending ? onRecover ? <Button variant="primary" disabled={loading || busy} onClick={onRecover}>{t('projects.delete.recover')}</Button> : null
          : reviewing ? <><Button variant="danger" disabled={!ready || busy} onClick={() => { if (ready && deletionPlanReady(plan, project.id)) setConfirmation(plan!.id); }}>{t('projects.delete.next')}</Button>{onReview ? <Button variant="secondary" disabled={loading || busy} onClick={onReview}>{t('projects.delete.refresh')}</Button> : null}</>
          : <>{operation?.canRetry && onRetry ? <Button variant="primary" disabled={loading || busy} onClick={onRetry}>{t('projects.delete.retry')}</Button> : null}{operation?.state === 'needs-attention' && onReview ? <Button variant="secondary" disabled={loading || busy} onClick={onReview}>{t('projects.delete.reconfirm')}</Button> : null}</>}
        {onRepair && plan && !plan.complete ? <Button variant="secondary" disabled={loading || busy} onClick={onRepair}>{t('projects.repair.title')}</Button> : null}
        <Button variant="ghost" disabled={closingLocked} onClick={onClose}>{t('projects.delete.close')}</Button>
      </ActionRow>}>
      <Stack><DefinitionList layout="grid" items={[{ label: t('projects.delete.project'), value: target.name }, { label: t('projects.delete.slug'), value: target.slug }]} />
        {operation ? <DeletionProgress operation={operation} /> : null}
        {pending ? <ActionNote tone="neutral">{t(onRecover ? 'projects.delete.unknown' : 'projects.delete.unverified')}</ActionNote> : null}
        {reviewing && !pending ? <>
          <ActionNote tone="neutral">{t('projects.delete.consequence')}</ActionNote>
          {loading ? <ActionNote tone="neutral">{t('projects.delete.loading')}</ActionNote> : plan ? <DeletionInventory plan={plan} /> : null}
          {plan && !ready && !loading ? <ActionNote tone="error">{t(Date.parse(plan.expiresAt) <= now ? 'projects.delete.expired' : 'projects.delete.blocked')}</ActionNote> : null}
          <ActionNote tone="neutral">{t('projects.delete.shared')}</ActionNote>
        </> : null}
        {error || localError ? <ActionNote tone="error">{error ?? localError}</ActionNote> : null}
      </Stack>
    </Dialog>
    {reviewing && !pending && plan && confirmation === plan.id ? <ConfirmDialog title={t('projects.delete.confirmTitle')} question={t('projects.delete.confirmQuestion', { name: target.name, slug: target.slug })}
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
