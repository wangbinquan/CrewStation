import { Link } from '@tanstack/react-router';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { FormField } from '../../../shared/ui/FormField';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { DefinitionList } from '../../../shared/ui/DefinitionList';
import type { PublishSource } from '../../../shared/project/releaseSearch';
import type { PublishPreparation } from '../model/usePublishPreparation';

export function PublishSourceFields({ preparation: p, onSource }: { readonly preparation: PublishPreparation; readonly onSource: (source: PublishSource) => void }) {
  const t = useT(), { projectId, space } = useProjectScope(), query = p.source === 'session' ? p.workspace : p.branches;
  const workspace = p.workspace.data;
  return <>
    <ActionRow>{(['repository', 'session'] as const).map((source) => <Button key={source} aria-pressed={p.source === source} disabled={p.busy} onClick={() => { if (p.resetCheck()) onSource(source); }}>{t(`release.prepare.source.${source}`)}</Button>)}</ActionRow>
    <p>{t(`release.prepare.hint.${p.source}`)}</p>
    <QueryStatus isPending={query.isPending} error={p.sessionMissing ? null : query.error} isEmpty={p.sessionMissing} emptyTitle={t('release.prepare.noSession')} emptyDescription={t('release.prepare.noSessionHint')} />
    {p.source === 'repository' ? <FormField label={t('release.publish.branch')} hint={t('release.prepare.branchHint')}>
      <select name="branch" value={p.selected} disabled={p.busy || p.branches.isPending || !!p.branches.error} onChange={(event) => { if (p.resetCheck()) p.setBranch(event.target.value); }}>
        {!p.branches.data?.items.length ? <option value="">{t(p.branches.isPending || p.branches.error ? 'release.prepare.unknown' : 'release.publish.branchEmpty')}</option> : null}
        {p.branches.data?.items.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.isDefault ? ` · ${t('release.publish.branchDefault')}` : ''} · {branch.headSha.slice(0, 10)}</option>)}
      </select>
    </FormField> : <>
      {workspace && !p.workspace.error ? <>
        <DefinitionList items={[{ label: t('release.prepare.task'), value: <code>{workspace.taskId}</code> }, ...(workspace.status === 'ready' ? [
          { label: t('release.publish.branch'), value: workspace.branch ?? t('release.prepare.detached') }, { label: 'HEAD', value: <code>{workspace.headSha ?? t('release.prepare.noHead')}</code> },
          { label: t('release.prepare.files'), value: String(workspace.uncommittedCount) },
        ] : [{ label: t('release.prepare.unknown'), value: workspace.reason }])]} />
        {workspace.status === 'ready' && workspace.uncommittedCount > 0 ? <><ul>{workspace.uncommitted.map((file) => <li key={file.path}><code>{file.status} </code>{file.status.includes('D') ? <code>{file.path}</code> : <Link to={PROJECT_PATHS[space].development} params={{ projectId }} search={{ view: 'code', file: file.path, task: workspace.taskId }}>{file.path}</Link>}</li>)}</ul>{workspace.uncommittedTruncated ? <p>{t('release.prepare.truncated')}</p> : null}</> : null}
      </> : null}
      <Link to={PROJECT_PATHS[space].development} params={{ projectId }} search={p.sessionMissing ? {} : { view: 'diff' }}>{t(p.sessionMissing ? 'release.prepare.enterDevelopment' : 'release.prepare.openDevelopment')}</Link>
    </>}
    <Button variant="primary" disabled={p.busy || !p.canPublish} onClick={() => void p.check()}>{t(p.checking ? 'release.prepare.checking' : 'release.prepare.check')}</Button>
  </>;
}
