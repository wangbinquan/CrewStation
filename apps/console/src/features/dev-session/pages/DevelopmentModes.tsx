import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useT } from '../../../shared/lib/useT';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { isGuidedDevelopment, parseDevelopmentSearch } from '../../../shared/project/developmentSearch';
import type { DevelopmentSearch } from '../../../shared/project/developmentSearch';
import { Segmented } from '../../../shared/ui/Segmented';
import { DialogVisibility } from '../../../shared/ui/dialog/DialogHost';
import styles from './DevelopmentModes.module.css';

/** 两种工作方式按需挂载、常驻保留；切换只改变可见性，不释放终端、草稿或正在发送的请求。 */
export function DevelopmentModes({ cli, bot }: { readonly cli: ReactNode; readonly bot: ReactNode }) {
  const t = useT(), navigate = useNavigate(), { projectId, space } = useProjectScope();
  const search = parseDevelopmentSearch(useSearch({ strict: false })), mode = isGuidedDevelopment(search) ? 'bot' : 'cli';
  const [visited, setVisited] = useState({ cli: mode === 'cli', bot: mode === 'bot' });
  const [locations, setLocations] = useState<Record<'cli' | 'bot', DevelopmentSearch>>({ cli: mode === 'cli' ? search : { view: 'cli' }, bot: mode === 'bot' ? search : { view: 'guided' } });
  if (!visited[mode]) setVisited({ ...visited, [mode]: true });
  if (JSON.stringify(locations[mode]) !== JSON.stringify(search)) setLocations({ ...locations, [mode]: search });
  return <div className={styles.page} data-development-modes="">
    <header className={styles.header}><h1>{t('devSession.title')}</h1>
      <Segmented label={t('devSession.bot.mode')} value={mode} items={[{ value: 'cli', label: 'CLI' }, { value: 'bot', label: t('devSession.bot.modeLabel') }]}
        onChange={value => { if (value !== mode) void navigate({ to: PROJECT_PATHS[space].development, params: { projectId }, search: locations[value as 'cli' | 'bot'] }); }} />
    </header>
    {(['cli', 'bot'] as const).map(value => <section key={value} aria-label={value === 'cli' ? 'CLI' : t('devSession.bot.modeLabel')} className={styles.surface} hidden={mode !== value} inert={mode !== value}>
      <DialogVisibility hidden={mode !== value}>{visited[value] || mode === value ? value === 'cli' ? cli : bot : null}</DialogVisibility>
    </section>)}
  </div>;
}
