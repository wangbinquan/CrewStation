import { useState } from 'react';
import type { ProjectPageEntry } from '@crewstation/contracts';
import type { ProjectDirectorySearch } from '../../../../shared/admin/projectDirectorySearch';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { INTEGRATION_KINDS } from '../../model/integrationKinds';
import styles from './ProjectDirectory.module.css';

export function ProjectDirectoryFilters({ search, items, integration, userId, busy, apply }: {
  readonly search: ProjectDirectorySearch; readonly items: readonly ProjectPageEntry[]; readonly integration: boolean;
  readonly userId?: string; readonly busy: boolean; readonly apply: (search: ProjectDirectorySearch) => void;
}) {
  const t = useT(), [draft, setDraft] = useState(search);
  const owners = new Map<string, string>(items.map((row) => [row.project.ownerUserId, row.ownerName ?? row.project.ownerUserId]));
  if (userId && !owners.has(userId)) owners.set(userId, t('admin.directory.mine'));
  if (draft.ownerUserId && !owners.has(draft.ownerUserId)) owners.set(draft.ownerUserId, draft.ownerUserId);
  const kinds = integration ? INTEGRATION_KINDS : ['DigitalWorker', ...INTEGRATION_KINDS];
  return <form role="search" aria-label={t('admin.directory.search')} className={styles.filters} onSubmit={(event) => { event.preventDefault(); if (!busy) apply({ ...draft, cursor: undefined }); }}>
    <label>{t('admin.directory.search')}<input aria-label={t('admin.directory.search')} value={draft.q ?? ''} maxLength={120} onChange={(e) => setDraft({ ...draft, q: e.target.value })} /></label>
    <label>{t('admin.directory.kind')}<select aria-label={t('admin.directory.kind')} value={draft.kind ?? ''} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProjectDirectorySearch['kind'] || undefined })}>
      <option value="">{t('admin.directory.allKinds')}</option>{kinds.map((kind) => <option key={kind} value={kind}>{t(`projects.kind.${kind}`)}</option>)}
    </select></label>
    <label>{t('admin.directory.state')}<select aria-label={t('admin.directory.state')} value={draft.state ?? ''} onChange={(e) => setDraft({ ...draft, state: e.target.value as ProjectDirectorySearch['state'] || undefined })}>
      <option value="">{t('admin.directory.allStates')}</option>{['provisioning', 'active', 'paused', 'archived', 'failed'].map((state) => <option key={state} value={state}>{t(`projects.state.${state}`)}</option>)}
    </select></label>
    <label>{t('admin.directory.owner')}<select aria-label={t('admin.directory.owner')} value={draft.ownerUserId ?? ''} onChange={(e) => setDraft({ ...draft, ownerUserId: e.target.value || undefined })}>
      <option value="">{t('admin.directory.allOwners')}</option>{[...owners].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <Button type="submit" disabled={busy}>{t('admin.directory.apply')}</Button><Button disabled={busy} onClick={() => apply({ q: '' })}>{t('admin.directory.clear')}</Button>
  </form>;
}
