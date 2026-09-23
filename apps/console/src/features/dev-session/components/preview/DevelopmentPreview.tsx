import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import type { BadgeTone } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import type { PreviewHandle } from '../../hooks/usePreviewStatus';
import { previewUrl } from '../../model/previewSnapshot';
import styles from './DevelopmentPreview.module.css';
import { ExternalButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

export function DevelopmentPreview({ preview, previewHost, connected, logs }: { readonly preview: PreviewHandle; readonly previewHost: string; readonly connected: boolean; readonly logs?: ReactNode }): ReactElement {
  const t = useT();
  const [generation, setGeneration] = useState(0);
  const url = connected && preview.confirmed ? previewUrl(previewHost, preview.status.state) : undefined;
  const running = preview.status.state === 'starting' || preview.status.state === 'ready';
  const known = connected && preview.confirmed;
  const blocked = !connected || preview.busy;
  const error = preview.error ?? preview.status.lastError;
  // 预览页直接铺满页签；工具栏在上方定住，不随页面滚动（2026-09-23）。
  return <section className={styles.preview} aria-busy={preview.busy} aria-label={t('devSession.native.developmentPreview')}>
    <header className={styles.toolbar}>
      <span title={t('devSession.native.previewHint')}><Badge tone={stateTone(known ? preview.status.state : undefined)}>{t(known ? `devSession.previewState.${preview.status.state}` : 'devSession.native.lifecycle.unknown')}</Badge></span>
      <Button size="small" disabled={blocked} onClick={() => { setGeneration((value) => value + 1); preview.refresh(); }}>{t('devSession.preview.refresh')}</Button>
      <Button size="small" disabled={blocked} onClick={() => preview.run('restart')}>{t('devSession.preview.restart')}</Button>
      {running
        ? <Button size="small" disabled={blocked} onClick={() => preview.run('stop')}>{t('devSession.preview.stop')}</Button>
        : <Button size="small" disabled={blocked || preview.status.state === 'disabled'} onClick={() => preview.run('start')}>{t('devSession.preview.start')}</Button>}
      {logs}
      {url ? <ExternalButtonLink size="small" href={url}>{t('devSession.native.openPreview')}</ExternalButtonLink> : null}
    </header>
    {error ? <p role="status" className={styles.error}>{error}</p> : null}
    {url ? <iframe key={generation} src={url} title={t('devSession.native.developmentPreview')} className={styles.frame} /> : <div className={styles.empty}>{t('devSession.preview.noUrl')}</div>}
  </section>;
}

function stateTone(state: PreviewHandle['status']['state'] | undefined): BadgeTone {
  if (state === 'ready') return 'success';
  if (state === 'starting') return 'info';
  if (state === 'crashed') return 'danger';
  return 'neutral';
}
