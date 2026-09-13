import { useState } from 'react';
import type { ProjectSummary } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { ProjectListSearch } from '../../model/projectListSearch';
import styles from './ProjectSummary.module.css';

export function ProjectListFilters({ search, items, userId, busy, apply }: {
  readonly search: ProjectListSearch; readonly items: readonly ProjectSummary[]; readonly userId?: string; readonly busy: boolean;
  readonly apply: (search: ProjectListSearch) => void;
}) {
  const t = useT(), [q, setQ] = useState(search.q ?? ''), [state, setState] = useState(search.state), [owner, setOwner] = useState(search.ownerUserId);
  const owners = new Map(items.map((item) => [item.project.ownerUserId as string, item.ownerName ?? item.project.ownerUserId]));
  if (userId) owners.set(userId, t('projects.summary.mine'));
  if (owner && !owners.has(owner)) owners.set(owner, owner);
  return <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); if (!busy) apply({ q, state, ownerUserId: owner }); }}>
    <label>{t('projects.summary.search')}<input aria-label={t('projects.summary.search')} maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} /></label>
    <label>{t('projects.summary.projectState')}<select aria-label={t('projects.summary.projectState')} value={state ?? ''} onChange={(e) => setState(e.target.value as ProjectListSearch['state'] || undefined)}>
      <option value="">{t('projects.summary.allStates')}</option>{(['provisioning', 'active', 'paused', 'archived', 'failed'] as const).map((value) => <option key={value} value={value}>{t(`projects.state.${value}`)}</option>)}
    </select></label>
    <label>{t('projects.summary.owner')}<select aria-label={t('projects.summary.owner')} value={owner ?? ''} onChange={(e) => setOwner(e.target.value || undefined)}>
      <option value="">{t('projects.summary.allOwners')}</option>{[...owners].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <Button type="submit" disabled={busy}>{t('projects.summary.searchSubmit')}</Button><Button disabled={busy} onClick={() => apply({ q: '' })}>{t('projects.summary.clear')}</Button>
  </form>;
}
