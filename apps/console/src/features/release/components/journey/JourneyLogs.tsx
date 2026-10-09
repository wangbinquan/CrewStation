import { useState } from 'react';
import type { LogSource } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { useProjectScope } from '../../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../../shared/project/projectPaths';
import { useLogFeed } from '../../../../shared/logs/useLogFeed';
import { LogList } from '../../../../shared/logs/LogList';
import { Button } from '../../../../shared/ui/Button';
import { ButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import { QueryStatus } from '../../../../shared/ui/QueryStatus';
import type { OperationsSearch } from '../../../../shared/project/operationsSearch';

export function JourneyLogs({ releaseId, active }: { readonly releaseId: string; readonly active: boolean }) {
  const t = useT(), [source, setSource] = useState<LogSource>();
  return <section aria-label={t('release.wizard.logs')}>
    <Button aria-expanded={!!source} onClick={() => setSource(value => value ? undefined : 'build')}>{t('release.wizard.logs')}</Button>
    {source ? <LogContent releaseId={releaseId} initialSource={source} active={active} /> : null}
  </section>;
}
function LogContent({ releaseId, initialSource, active }: { readonly releaseId: string; readonly initialSource: LogSource; readonly active: boolean }) {
  const t = useT(), { projectId, space } = useProjectScope();
  const [selected, setSelected] = useState<OperationsSearch>({ tab: 'logs', source: initialSource, releaseId, limit: 200, slot: 'all' });
  const feed = useLogFeed(projectId, selected, setSelected, active);
  return <>
    <label>{t('release.wizard.logSource')} <select value={selected.source} onChange={event => setSelected({ ...selected, source: event.target.value as LogSource })}>
      {(['build', 'migration', 'slot'] as const).map(source => <option key={source} value={source}>{t(`logs.source.${source}`)}</option>)}
    </select></label>
    <ButtonLink to={PROJECT_PATHS[space].operations} params={{ projectId }} search={selected} target="_blank" rel="noreferrer">{t('release.wizard.fullLogs')}</ButtonLink>
    <QueryStatus isPending={feed.isPending} error={feed.error} isEmpty={!feed.isPending && !feed.error && !feed.entries.length} emptyTitle={t('logs.list.emptyTitle')} />
    {feed.entries.length ? <LogList entries={feed.entries} follow={active} /> : null}
    <p>{t('release.wizard.logRetention')}</p>
  </>;
}
