import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectDeletionRepairItem, ProjectDeletionRepairList } from '@crewstation/contracts';
import type { ProjectDeletionsResource } from '@crewstation/api-client';
import { useT } from '../../../shared/lib/useT';
import { ActionNote } from '../../../shared/ui/ActionNote';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { DataTable } from '../../../shared/ui/DataTable';
import { Stack } from '../../../shared/ui/Stack';
import { ChoiceField } from '../../../shared/ui/selection/ChoiceField';
import { FormDialog } from '../../../shared/ui/dialog/FormDialog';

export type ProjectRepairDraft = Readonly<Record<string, { originalDigest: string; evidenceDigest: string; decision: 'retain' | 'reclaim' }>>;
const itemKey = (item: ProjectDeletionRepairItem) => item.owner + ':' + item.key;

/** The opener retains every explicit choice. Saving current facts never starts permanent deletion. */
export function ProjectDeletionRepairForm({ projectId, open, resource, draft, onDraft, onSaved, onClose }: {
  projectId: string; open: boolean; resource: ProjectDeletionsResource; draft: ProjectRepairDraft;
  onDraft(draft: ProjectRepairDraft): void; onSaved(): void; onClose(): void;
}) {
  const t = useT(), [list, setList] = useState<ProjectDeletionRepairList>(), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState<string>();
  const active = useRef(0), inFlight = useRef(false), changed = useRef(false);
  const load = useCallback(async () => {
    const sequence = ++active.current; setLoading(true); setError(undefined); setList(undefined);
    try {
      if (!resource.repairItems) throw new Error('unavailable');
      const result = await resource.repairItems(projectId);
      if (active.current === sequence) setList(result);
    } catch { if (active.current === sequence) setError(t('projects.repair.loadFailed')); }
    finally { if (active.current === sequence) setLoading(false); }
  }, [projectId, resource, t]);
  useEffect(() => {
    let cancelled = false; const sequence = active;
    if (open) void Promise.resolve().then(() => { if (!cancelled) return load(); });
    return () => { cancelled = true; sequence.current++; };
  }, [open, load]);
  const close = () => { onClose(); if (changed.current) { changed.current = false; onSaved(); } };
  const selected = (list?.items ?? []).filter((item) => {
    const choice = draft[itemKey(item)]; return choice && !item.confirmed && !item.blockers.length && item.allowedDecisions.includes(choice.decision)
      && choice.originalDigest === item.originalDigest && choice.evidenceDigest === item.evidenceDigest;
  });
  const save = async () => {
    if (inFlight.current || loading || !list?.complete || !selected.length || !resource.confirmRepair) return;
    inFlight.current = true; setSaving(true); setError(undefined); let completed = 0;
    try {
      for (const item of selected) {
        const confirmed = await resource.confirmRepair(projectId, { owner: item.owner, key: item.key, originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision: draft[itemKey(item)]!.decision });
        setList((previous) => previous ? { ...previous, items: previous.items.map((entry) => itemKey(entry) === itemKey(confirmed) ? confirmed : entry) } : previous); completed++; changed.current = true;
      }
      onDraft({}); close();
    } catch { setError(t(completed ? 'projects.repair.partial' : 'projects.repair.saveFailed', { count: completed })); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return open ? <FormDialog title={t('projects.repair.title')} size="large" submitLabel={t('projects.repair.save', { count: selected.length })} busyLabel={t('projects.repair.saving')} busy={saving}
    submitDisabled={loading || !list?.complete || !selected.length} error={error} onSubmit={() => { void save(); }} onClose={close}
    onClear={() => onDraft({})} dirty={Object.keys(draft).length > 0} actions={<Button variant="secondary" disabled={loading || saving} onClick={() => { void load(); }}>{t('projects.repair.refresh')}</Button>}>
    <Stack><ActionNote tone="neutral">{t('projects.repair.explanation')}</ActionNote><ActionNote tone="neutral">{t('projects.repair.afterSave')}</ActionNote>
      {loading ? <ActionNote tone="neutral">{t('projects.repair.loading')}</ActionNote> : null}
      {list?.blockers.map((message, index) => <ActionNote key={index} tone="error">{message}</ActionNote>)}
      {!loading && list && !list.items.length ? <ActionNote tone="neutral">{t('projects.repair.empty')}</ActionNote> : null}
      {list?.items.map((item) => {
        const key = itemKey(item), choice = draft[key], checked = choice?.originalDigest === item.originalDigest && choice.evidenceDigest === item.evidenceDigest ? choice.decision : undefined;
        return <Card key={key} title={item.title} stacked extra={<Badge tone={item.confirmed ? 'success' : item.blockers.length ? 'danger' : 'neutral'}>{t(item.confirmed ? 'projects.repair.confirmed' : item.blockers.length ? 'projects.repair.blocked' : 'projects.repair.toReview')}</Badge>}>
          <DataTable columns={[t('projects.repair.source'), t('projects.repair.fact')]}>
            {item.facts.map((fact, index) => <tr key={index}><td>{fact.label}</td><td>{fact.value}</td></tr>)}
            <tr><td>{t('projects.repair.originalDigest')}</td><td><code style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{item.originalDigest}</code></td></tr><tr><td>{t('projects.repair.evidenceDigest')}</td><td><code style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{item.evidenceDigest}</code></td></tr>
          </DataTable>
          {item.blockers.map((message, index) => <ActionNote key={index} tone="error">{message}</ActionNote>)}
          {item.confirmed ? <ActionNote tone="success">{t('projects.repair.receipt', { actor: item.confirmed.actorId, at: item.confirmed.confirmedAt })}</ActionNote>
            : item.allowedDecisions.map((decision) => <ChoiceField key={decision} type="radio" name={key} label={t(`projects.repair.choice.${decision}`)} description={t(`projects.repair.choice.${decision}Hint`)} disabled={saving || loading || !!item.blockers.length}
              checked={checked === decision} onChange={() => onDraft({ ...draft, [key]: { originalDigest: item.originalDigest, evidenceDigest: item.evidenceDigest, decision } })} />)}
        </Card>;
      })}
    </Stack>
  </FormDialog> : null;
}
