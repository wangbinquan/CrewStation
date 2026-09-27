import type { RuntimeImageBuildDto } from '@crewstation/contracts';
import { ImageActionConfirmation } from './ImageActionConfirmation';
import { useRef, useState } from 'react';
import { api } from '../../../shared/api/client';
import { useApiMutation, useApiQuery } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { DataTable } from '../../../shared/ui/DataTable';
import { QueryStatus } from '../../../shared/ui/QueryStatus';
import { Dialog } from '../../../shared/ui/dialog/Dialog';
import styles from './RuntimeImages.module.css';

export function BuildHistory({ projectId, imageId, editable }: { readonly projectId: string | undefined; readonly imageId: string; readonly editable: boolean }) {
  const t = useT(), key = ['runtime-images', projectId, imageId, 'builds'];
  const [before, setBefore] = useState<string>(), [selected, setSelected] = useState<string>();
  const builds = useApiQuery([...key, before], () => api.runtimeImages.builds(projectId, imageId, { before, limit: 20 }), { refetchIntervalMs: 3_000 });
  const [cancelling, setCancelling] = useState<RuntimeImageBuildDto>();
  const cancel = useApiMutation((id: string) => api.runtimeImages.cancelBuild(projectId, imageId, id, `cancel:${id}`), { invalidate: [key], onSuccess: () => setCancelling(undefined) });
  return <div className={styles.stack}>
    <h3>{t('images.builds')}</h3><p className={styles.note}>{t('images.buildsHint')}</p><QueryStatus isPending={builds.isPending} error={builds.error} isEmpty={builds.data?.items.length === 0} emptyTitle={t('images.noBuild')} />
    {builds.data?.items.length ? <DataTable columns={[t('images.created'), t('images.state'), t('images.actions')]}>
      {builds.data.items.map((build) => <tr key={build.id}><td><time>{new Date(build.createdAt).toLocaleString()}</time></td><td>{t(`images.state.${build.state}`)}{build.unknown ? ` · ${t('images.state.unknown')}` : ''}{build.error ? <p>{build.error}</p> : null}</td><td><div className={styles.row}>
        <Button size="small" onClick={() => setSelected(build.id)}>{t('images.logs')}</Button>
        {editable && !['succeeded', 'failed', 'cancelled'].includes(build.state) ? <Button size="small" variant="danger" disabled={cancel.isPending || build.state === 'cancelling'} onClick={() => { cancel.reset(); setCancelling(build); }}>{t('images.cancelBuild')}</Button> : null}
      </div></td></tr>)}
    </DataTable> : null}
    {cancelling ? <ImageActionConfirmation title={t('images.cancelBuild')} target={<p>{new Date(cancelling.createdAt).toLocaleString()} · {cancelling.id}</p>} hint={t('images.confirmCancelBuild')} busy={cancel.isPending} error={cancel.error} onCancel={() => setCancelling(undefined)} onConfirm={() => cancel.mutate(cancelling.id)} /> : null}
    <div className={styles.row}>{before ? <Button onClick={() => setBefore(undefined)}>{t('images.first')}</Button> : null}{builds.data?.items.length === 20 ? <Button onClick={() => setBefore(builds.data!.items.at(-1)!.id)}>{t('images.next')}</Button> : null}</div>
    {selected ? <Dialog title={t('images.logs')} size="large" onClose={() => setSelected(undefined)}><BuildLog key={selected} projectId={projectId} imageId={imageId} buildId={selected} /></Dialog> : null}
  </div>;
}

function BuildLog({ projectId, imageId, buildId }: { readonly projectId: string | undefined; readonly imageId: string; readonly buildId: string }) {
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
