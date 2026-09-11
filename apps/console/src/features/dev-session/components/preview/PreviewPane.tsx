import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import type { PreviewHandle } from '../../hooks/usePreviewStatus';
import { previewUrl } from '../../model/previewSnapshot';
import { previewStateTone } from '../../model/stateTone';
import { Pane } from '../Pane';
import { PaneNotice } from '../PaneNotice';
import styles from './PreviewPane.module.css';

export interface PreviewPaneProps {
  readonly preview: PreviewHandle;
  readonly previewHost: string;
}

/** 预览进程：状态、端口、重启次数与最近一次错误；TaskRunner 协议只给了重启，没有单独启停。 */
export function PreviewPane({ preview, previewHost }: PreviewPaneProps): ReactElement {
  const t = useT();
  const { status } = preview;
  const url = previewUrl(previewHost, status.state);
  return (
    <Pane
      title={t('devSession.preview.title')}
      className={styles.pane}
      extra={
        <>
          <Button disabled={preview.busy} onClick={preview.refresh}>
            {t('devSession.preview.refresh')}
          </Button>
          <Button disabled={preview.busy} onClick={preview.restart}>
            {t('devSession.preview.restart')}
          </Button>
        </>
      }
    >
      <DefinitionList
        layout="grid"
        items={[
          { label: t('devSession.preview.state'), value: <Badge tone={previewStateTone(status.state)}>{t(`devSession.previewState.${status.state}`)}</Badge> },
          { label: t('devSession.preview.port'), value: status.port === undefined ? '—' : String(status.port) },
          { label: t('devSession.preview.restarts'), value: String(status.restarts) },
        ]}
      />
      {url === undefined ? (
        <PaneNotice tone="muted">{t('devSession.preview.noUrl')}</PaneNotice>
      ) : (
        <p className={styles.link}>
          <a href={url} target="_blank" rel="noreferrer">
            {previewHost}
          </a>
        </p>
      )}
      {status.lastError !== undefined ? <PaneNotice tone="warning">{status.lastError}</PaneNotice> : null}
      {preview.error !== undefined ? <PaneNotice tone="warning">{preview.error}</PaneNotice> : null}
      <PaneNotice tone="muted">{t('devSession.preview.controlsHint')}</PaneNotice>
    </Pane>
  );
}
