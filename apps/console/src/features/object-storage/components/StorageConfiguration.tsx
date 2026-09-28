import { useState } from 'react';
import type { ObjectBackendDto, ObjectStoragePlanDto } from '@crewstation/contracts';
import { api } from '../../../shared/api/client';
import { AUTO_REFRESH, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/EmptyState';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Stack } from '../../../shared/ui/Stack';
import { backendDraft, planDraft } from '../model/storageDraft';
import type { BackendDraft, PlanDraft } from '../model/storageDraft';
import { storageBytes, storageTime, storageTone } from '../model/storageValues';
import { BackendEditor } from './BackendEditor';
import { PlanEditor } from './PlanEditor';
import { ProjectStorageAccess } from './ProjectStorageAccess';
import { BackendCredentialDialog } from './BackendCredentialDialog';
import styles from './Storage.module.css';

export function StorageConfiguration({ inspect }: { inspect: (target: { name: string; backendId: string }) => void }) {
  const t = useT(), backends = useApiQuery(['object-storage', 'backends'], () => api.objectStorage.backends(), AUTO_REFRESH);
  const plans = useApiQuery(['object-storage', 'plans'], () => api.objectStorage.plans(), AUTO_REFRESH);
  const [editing, setEditing] = useState<{ kind: 'backend' | 'plan'; id: string }>(), [access, setAccess] = useState(false);
  const [backendDrafts, setBackendDrafts] = useState<Record<string, { original?: ObjectBackendDto; draft: BackendDraft }>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, { original?: ObjectStoragePlanDto; draft: PlanDraft }>>({});
  const [rotating, setRotating] = useState<string>(), [rotationTargets, setRotationTargets] = useState<Record<string, ObjectBackendDto>>({});
  const editBackend = (original?: ObjectBackendDto) => { const id = original?.id ?? 'new'; setBackendDrafts((old) => old[id] ? old : { ...old, [id]: { original, draft: backendDraft(original) } }); setEditing({ kind: 'backend', id }); };
  const editPlan = (original?: ObjectStoragePlanDto) => { const id = original?.id ?? 'new'; setPlanDrafts((old) => old[id] ? old : { ...old, [id]: { original, draft: planDraft(original, backends.data?.items[0]?.id) } }); setEditing({ kind: 'plan', id }); };
  const saved = () => { if (!editing) return; if (editing.kind === 'backend') setBackendDrafts((old) => { const next = { ...old }; delete next[editing.id]; return next; });
    else setPlanDrafts((old) => { const next = { ...old }; delete next[editing.id]; return next; }); setEditing(undefined); };
  return <Stack><Card title={t('objects.backends')} stacked><ActionRow><Button onClick={() => editBackend()}>{t('objects.addBackend')}</Button></ActionRow>
    <QueryStatus isPending={backends.isPending} error={backends.error} />
    {backends.data?.items.length === 0 ? <EmptyState title={t('objects.noBackend')} /> : null}
    {backends.data?.items.length ? <DataTable columns={[t('objects.name'), t('objects.health'), t('objects.capacity'), t('objects.physicalReserved'), t('objects.physicalFree'), t('objects.actions')]}>{backends.data.items.map((b) => {
      const health = b.state === 'offline' ? 'unavailable' : b.health;
      return <tr key={b.id}><td>{b.name}<span className={`${styles.muted} ${styles.compact}`}>{t(`objects.${b.durability}`)} · {t(`objects.${b.state}`)}</span></td>
        <td><Badge tone={storageTone(health)}>{t(`objects.${health}`)}</Badge><span className={`${styles.muted} ${styles.compact}`}>{storageTime(b.observedAt)}{b.message ? ` · ${b.message}` : ''}</span></td>
        <td>{storageBytes(b.budgetBytes)}</td><td>{storageBytes(b.reservedBytes)}</td><td>{storageBytes(b.physicalFreeBytes)}</td>
        <td><ActionRow><Button size="small" onClick={() => inspect({ name: b.name, backendId: b.id })}>{t('objects.inspect')}</Button><Button size="small" onClick={() => editBackend(b)}>{t('objects.editBackend')}</Button>
          <Button size="small" onClick={() => { setRotationTargets((old) => old[b.id] ? old : { ...old, [b.id]: b }); setRotating(b.id); }}>{t('objects.rotateTitle')}</Button></ActionRow></td></tr>;
    })}</DataTable> : null}</Card>
    <Card title={t('objects.plans')} stacked><ActionRow><Button onClick={() => editPlan()} disabled={!backends.data?.items.length}>{t('objects.addPlan')}</Button><Button onClick={() => setAccess(true)}>{t('objects.projectAccess')}</Button></ActionRow>
      <QueryStatus isPending={plans.isPending} error={plans.error} />
      {plans.data?.items.length === 0 ? <EmptyState title={t('objects.noPlans')} /> : null}
      {plans.data?.items.length ? <DataTable columns={[t('objects.name'), t('objects.backend'), t('objects.capacity'), t('objects.objectLimit'), t('objects.transfers'), t('objects.state'), t('objects.actions')]}>{plans.data.items.map((p) => <tr key={p.id}>
        <td>{p.name}<span className={`${styles.code} ${styles.compact}`}>{p.id}</span></td><td>{backends.data?.items.find((b) => b.id === p.backendId)?.name ?? p.backendId}</td>
        <td>{storageBytes(p.quotaBytes)}</td><td>{storageBytes(p.maxObjectBytes)}</td><td>{p.maxConcurrentTransfers}</td><td>{t(p.enabled ? 'objects.enabled' : 'objects.disabled')}</td>
        <td><Button size="small" onClick={() => editPlan(p)}>{t('objects.editPlan')}</Button></td></tr>)}</DataTable> : null}
    </Card>
    {editing?.kind === 'backend' ? <BackendEditor key={editing.id} {...backendDrafts[editing.id]!} change={(draft) => setBackendDrafts((old) => ({ ...old, [editing.id]: { ...old[editing.id]!, draft } }))} close={() => setEditing(undefined)} saved={saved} /> : null}
    {editing?.kind === 'plan' ? <PlanEditor key={editing.id} {...planDrafts[editing.id]!} backends={backends.data?.items ?? []} change={(draft) => setPlanDrafts((old) => ({ ...old, [editing.id]: { ...old[editing.id]!, draft } }))} close={() => setEditing(undefined)} saved={saved} /> : null}
    <ProjectStorageAccess open={access} close={() => setAccess(false)} plans={plans.data?.items ?? []} />
    {Object.values(rotationTargets).map((backend) => <BackendCredentialDialog key={backend.id} backend={backend} open={rotating === backend.id} close={() => setRotating(undefined)} saved={() => {
      setRotating(undefined); setRotationTargets((old) => { const next = { ...old }; delete next[backend.id]; return next; });
    }} />)}
  </Stack>;
}
