import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import type { PreviewHandle } from '../../hooks/usePreviewStatus';
import { previewUrl } from '../../model/previewSnapshot';
import styles from './DevelopmentPreview.module.css';

export function DevelopmentPreview({ preview, previewHost, connected, logs }: { readonly preview: PreviewHandle; readonly previewHost: string; readonly connected: boolean; readonly logs?: ReactNode }): ReactElement {
  const t = useT();
  const [generation, setGeneration] = useState(0);
  const url = connected && preview.confirmed ? previewUrl(previewHost, preview.status.state) : undefined;
  return <section className={styles.preview} aria-busy={preview.busy}>
    <header><strong>{t('devSession.native.developmentPreview')}</strong><span>{t(!connected || !preview.confirmed ? 'devSession.native.lifecycle.unknown' : `devSession.previewState.${preview.status.state}`)}</span>
      <Button variant="ghost" disabled={!connected || preview.busy} onClick={() => { setGeneration((value) => value + 1); preview.refresh(); }}>{t('devSession.preview.refresh')}</Button><Button variant="ghost" disabled={!connected || preview.busy} onClick={preview.restart}>{t('devSession.preview.restart')}</Button>
      {logs}
      {url ? <a href={url} target="_blank" rel="noreferrer">{t('devSession.native.openPreview')}</a> : null}
    </header>
    <p>{t('devSession.native.previewHint')}</p>
    {preview.error || preview.status.lastError ? <p role="status">{preview.error ?? preview.status.lastError}</p> : null}
    {url ? <iframe key={generation} src={url} title={t('devSession.native.developmentPreview')} className={styles.frame} /> : <div className={styles.empty}>{t('devSession.preview.noUrl')}</div>}
  </section>;
}
