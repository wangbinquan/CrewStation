import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { ActionNote } from '../../../shared/ui/ActionNote';
import styles from './RuntimeImages.module.css';

export function BuildHistory({ projectId, imageId, editable }: { readonly projectId: string; readonly imageId: string; readonly editable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'builds'];
  const [before, setBefore] = useState<string>(), [selected, setSelected] = useState<string>();
  const builds = useApiQuery([...key, before], () => api.runtimeImages.builds(projectId, imageId, { before, limit: 20 }), { refetchIntervalMs: 3_000 });
  const cancel = useApiMutation((id: string) => api.runtimeImages.cancelBuild(projectId, imageId, id, `cancel:${id}`), { invalidate: [key] });
  return <div className={styles.stack}>
    <h3>{t('images.builds')}</h3><QueryStatus isPending={builds.isPending} error={builds.error} />
    {builds.data?.items.length ? <DataTable columns={[t('images.created'), t('images.state'), t('images.actions')]}>
      {builds.data.items.map((build) => <tr key={build.id}><td><time>{new Date(build.createdAt).toLocaleString()}</time></td><td>{t(`images.state.${build.state}`)}{build.unknown ? ` · ${t('images.state.unknown')}` : ''}{build.error ? <p>{build.error}</p> : null}</td><td><div className={styles.row}>
        <Button size="small" onClick={() => setSelected(build.id)}>{t('images.logs')}</Button>
        {editable && !['succeeded', 'failed', 'cancelled'].includes(build.state) ? <Button size="small" variant="danger" disabled={cancel.isPending || build.state === 'cancelling'} onClick={() => cancel.mutate(build.id)}>{t('images.cancelBuild')}</Button> : null}
      </div></td></tr>)}
    </DataTable> : null}
    {cancel.error ? <ActionNote tone="error">{errorMessage(cancel.error)}</ActionNote> : null}
    <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{builds.data?.items.length === 20 ? <Button onClick={() => setBefore(builds.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
    {selected ? <BuildLog key={selected} projectId={projectId} imageId={imageId} buildId={selected} /> : null}
  </div>;
}

function BuildLog({ projectId, imageId, buildId }: { readonly projectId: string; readonly imageId: string; readonly buildId: string }) {
  const t = useT();
  const buffer = useRef({ after: 0, lines: [] as string[], truncated: false });
  const logs = useApiQuery(['runtime-images', projectId, imageId, 'logs', buildId], async () => {
    const previous = buffer.current, page = await api.runtimeImages.logs(projectId, imageId, buildId, previous.after);
    const lines = [...previous.lines, ...page.items.map((line) => line.text)];
    const next = { after: page.next, lines: lines.slice(-500), truncated: previous.truncated || page.truncated || lines.length > 500 };
    buffer.current = next;
    return next;
  }, { refetchIntervalMs: 2_000 });
  return <div className={styles.stack}>
    <p className={styles.identity}>{buildId}</p><QueryStatus isPending={logs.isPending} error={logs.error} />
    {logs.data?.truncated ? <p>{t('images.logsTruncated')}</p> : null}
    {!logs.error ? <pre className={styles.code} aria-label={t('images.logs')}>{logs.data?.lines.join('\n')}</pre> : null}
  </div>;
}
