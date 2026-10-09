import { useNavigate, useSearch } from '@tanstack/react-router';
import { ReleaseJourneyPageSchema } from '@crewstation/contracts';
import type { ReleaseJourneyListItem } from '@crewstation/contracts';
import { api } from '../../../../shared/api/client';
import { useApiQuery } from '../../../../shared/api/useApi';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { PROJECT_PATHS, RELEASE_PATHS } from '../../../../shared/project/projectPaths';
import { parseReleaseSearch } from '../../../../shared/project/releaseSearch';
import { Card } from '../../../../shared/ui/Card';
import { DataTable } from '../../../../shared/ui/DataTable';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import { Button } from '../../../../shared/ui/Button';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import { journeyEnded } from '../../model/journey/view';
import { useHistoryContext } from '../../model/journey/useHistoryContext';
import { wizardStorageKey } from '../../model/journey/storage';

export function ReleaseHistory({ serviceId, userId }: { readonly serviceId: string; readonly userId: string }) {
  const t = useT(), { projectId, space } = useProjectScope(), search = parseReleaseSearch(useSearch({ strict: false })), navigate = useNavigate();
  const query = useApiQuery(['release-journeys', serviceId, search.filter ?? '', search.cursor ?? ''], async () => ReleaseJourneyPageSchema.parse(await api.services.listReleaseJourneys(serviceId, { limit: 20, cursor: search.cursor, filter: search.filter })), { refetchIntervalMs: search.cursor ? undefined : 5000 });
  const members = useApiQuery(queryKeys.members(projectId), () => api.projects.listMembers(projectId));
  const names = new Map((members.data?.items ?? []).map(member => [member.userId as string, member.name]));
  const { ref: historyRef, remember } = useHistoryContext(wizardStorageKey(userId, space, projectId, `history:${search.filter ?? ''}:${search.cursor ?? ''}`), search.focus, !!query.data);
  const page = (cursor?: string, filter?: 'active' | 'ended') => { void navigate({ to: PROJECT_PATHS[space].release, params: { projectId }, search: { cursor, filter } }); };
  return <div ref={historyRef}><Card title={t('release.wizard.historyTitle')}>
    <QueryStatus isPending={query.isPending} error={query.error} isEmpty={query.data?.items.length === 0} emptyTitle={t('release.history.empty')} />
    <label>{t('release.wizard.filter')} <select value={search.filter ?? 'all'} onChange={event => page(undefined, event.target.value === 'all' ? undefined : event.target.value as 'active' | 'ended')}>
      {(['all', 'active', 'ended'] as const).map(value => <option key={value} value={value}>{t(`release.wizard.filter.${value}`)}</option>)}
    </select></label>
    {query.data?.items.length ? <DataTable columns={['version', 'operation', 'progress', 'source', 'initiator', 'started', 'action'].map(name => t(`release.wizard.column.${name}`))}>
      {query.data.items.map(item => <HistoryRow key={item.recordKind === 'journey' ? item.id : item.release.id} item={item} cursor={search.cursor} filter={search.filter} names={names} remember={remember} />)}
    </DataTable> : null}
    <div>
      {search.cursor ? <Button variant="ghost" onClick={() => page(undefined, search.filter)}>{t('release.wizard.firstPage')}</Button> : null}
      {query.data?.hasMore ? <Button disabled={!!query.error} onClick={() => page(query.data?.nextCursor, search.filter)}>{t('release.wizard.nextPage')}</Button> : null}
    </div>
  </Card></div>;
}
function HistoryRow({ item, cursor, filter, names, remember }: { readonly item: ReleaseJourneyListItem; readonly cursor?: string; readonly filter?: 'active' | 'ended'; readonly names: ReadonlyMap<string, string>; readonly remember: () => unknown }) {
  const t = useT(), date = useDateText(), { projectId, space } = useProjectScope();
  const journal = item.recordKind === 'journey' ? item : undefined, release = item.recordKind === 'legacy' ? item.release : undefined;
  const id = journal?.id ?? release!.id, search = { cursor, filter, focus: id }, actor = journal?.snapshot.actorUserId ?? release?.createdBy;
  return <tr>
    <td><strong>{journal?.snapshot.tag ?? release!.tag}</strong><br /><code title={journal?.snapshot.commitSha ?? release!.commitSha}>{(journal?.snapshot.commitSha ?? release!.commitSha).slice(0, 12)}</code></td>
    <td>{t(`release.wizard.kind.${journal?.snapshot.kind ?? 'legacy'}`)}</td>
    <td>{journal ? t(`release.wizard.status.${journal.status}`) : t(`release.status.${release!.status}`)}</td>
    <td>{t(`release.wizard.source.${journal?.snapshot.source.kind ?? 'legacy'}`)}</td>
    <td title={actor}>{actor ? names.get(actor) ?? `${actor.slice(0, 8)}…` : '—'}</td>
    <td>{date(journal?.snapshot.startedAt ?? release!.createdAt)}</td>
    <td>{journal ? <ButtonLink id={`release-history-${id}`} size="small" to={RELEASE_PATHS[space].journey} params={{ projectId, journeyId: id }} search={search} onClick={remember}>{t(journeyEnded(journal.status) ? 'release.wizard.view' : 'release.wizard.continue')}</ButtonLink>
      : <ButtonLink id={`release-history-${id}`} size="small" to={RELEASE_PATHS[space].version} params={{ projectId, releaseId: id }} search={search} onClick={remember}>{t('release.wizard.view')}</ButtonLink>}</td>
  </tr>;
}
