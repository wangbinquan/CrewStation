import type { DevSessionDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button, ButtonSizeContext } from '../../../../shared/ui/Button';
import { StageProgress, useProgressClock } from '../../../../shared/ui/progress/StageProgress';
import type { Progress } from '../../../../shared/ui/progress/stageProgressView';
import { OPEN_ANYWAY_MS, RECONNECT_OFFER_MS } from '../../model/connection/entryProgress';
import type { EntryStep } from '../../model/connection/entryProgress';
import styles from './SessionEntry.module.css';

/**
 * 开发页连接就绪之前的整页（2026-09-23 作者裁定）：内容区只有居中的这一块，页头、CLI 区与工具面板都等就绪后才出现。
 * `busy` 表示还在等（步骤清单、启动中、释放中）；停在失败上时不算，实机验收脚本据 `data-page-loading` 等页面稳定。
 */
export function SessionEntryFrame({ busy, children }: { readonly busy: boolean; readonly children: ReactNode }): ReactElement {
  const t = useT();
  return <div className={styles.frame} data-page-loading={busy ? '' : undefined} aria-busy={busy}>
    <h1 className={styles.hidden}>{t('devSession.title')}</h1>
    {/* 开发页整片是工具条密度（按钮紧凑档），整页状态也一样；弹窗底座会复位。 */}
    <ButtonSizeContext.Provider value="small"><div className={styles.body}>{children}</div></ButtonSizeContext.Provider>
  </div>;
}

export interface EntryStepsProps {
  readonly progress: Progress<EntryStep>;
  readonly branch?: string;
  readonly logs?: ReactNode;
  /** 页面通道已经失败过（重连过或报过错）：「重新连接页面」立即给，否则等满 RECONNECT_OFFER_MS。 */
  readonly channelTrouble?: boolean;
  readonly onReconnect?: () => void;
  /** 当前一步等满 OPEN_ANYWAY_MS 后给「仍然打开工作区」：打开后就是就绪前的工作区，可在「会话与环境」里看详情或释放会话。 */
  readonly onOpenAnyway?: () => void;
}

/** 进开发页的步骤清单：已完成的打勾带用时，当前一步带计时，没开始的空心（与启动进度同一套样式）。 */
export function EntrySteps({ progress, branch, logs, channelTrouble = false, onReconnect, onOpenAnyway }: EntryStepsProps): ReactElement {
  const t = useT(), { now } = useProgressClock(progress);
  const current = progress.stages.find((stage) => stage.state === 'running');
  const waited = current?.startedAt ? now - Date.parse(current.startedAt) : 0;
  const reconnect = onReconnect && current?.kind === 'channel' && (channelTrouble || waited >= RECONNECT_OFFER_MS);
  const openAnyway = onOpenAnyway && current !== undefined && current.kind !== 'session' && waited >= OPEN_ANYWAY_MS;
  const actions = reconnect || logs || openAnyway ? <>
    {reconnect ? <Button variant="primary" onClick={onReconnect}>{t('devSession.connection.reconnect')}</Button> : null}
    {logs}
    {openAnyway ? <Button title={t('devSession.entry.openAnywayHint')} onClick={onOpenAnyway}>{t('devSession.entry.openAnyway')}</Button> : null}
  </> : undefined;
  return <StageProgress progress={progress} title={branch ? t('devSession.entry.titleBranch', { branch }) : t('devSession.entry.title')}
    label={(stage) => t(`devSession.entry.step.${stage.kind}`)} actions={actions} />;
}

export type BlockedStatus = 'failed' | 'protocol' | 'releasing';

const STATUS_ICON: Record<BlockedStatus, string> = { failed: '✕', protocol: '!', releasing: '●' };

/**
 * 进来时就停在失败或要处理的状态：整页一张状态卡写明原因（失败连同任务号，读屏即时播报），恢复入口紧跟在卡下面，
 * 不必先打开「会话与环境」面板。
 */
export function SessionBlocked({ status, session, logs }: { readonly status: BlockedStatus; readonly session: DevSessionDto; readonly logs?: ReactNode }): ReactElement {
  const t = useT(), title = t(`devSession.connection.${status}`);
  const reason = status === 'releasing' ? undefined : session.connectionIssue?.message ?? session.message;
  return <section className={styles.status} data-state={status} aria-label={title}>
    <div className={styles.message} role={status === 'releasing' ? 'status' : 'alert'}>
      <h2 className={styles.statusTitle}><span className={styles.icon} aria-hidden="true">{STATUS_ICON[status]}</span>{title}</h2>
      {reason ? <p className={styles.reason}>{reason}</p> : null}
      <p className={styles.hint}>{t(status === 'protocol' ? 'devSession.entry.protocolHint' : `devSession.connection.${status}Hint`)}</p>
      {status === 'failed' ? <p className={styles.hint}>{session.taskId} · {t('devSession.failed.worktree')}</p> : null}
    </div>
    {logs ? <div className={styles.actions}>{logs}</div> : null}
  </section>;
}
