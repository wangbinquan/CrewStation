import type { ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useT } from '../../lib/useT';
import { Button } from '../Button';
import type { Progress, ProgressStage } from './stageProgressView';
import { clockSkew, formatDuration, stageElapsed, stageLabel, stagePosition, totalElapsed } from './stageProgressView';
import styles from './StageProgress.module.css';

const ICON: Record<ProgressStage['state'], string> = { succeeded: '✓', running: '●', pending: '○', failed: '✕', skipped: '–' };

/**
 * 有进行中的段时每秒刷新一次；时钟偏差由服务器读出时刻与本机收到时刻算出（RFC-022 B9）。
 * 刚收到的进度比上一次走表更新时，以收到的时刻为准，不会显示一秒前的计时。
 */
export function useProgressClock(progress: Progress | undefined): { now: number; skew: number } {
  const running = progress?.state === 'running', receivedAt = progress?.receivedAt;
  const skew = receivedAt === undefined ? 0 : clockSkew(progress?.observedAt, receivedAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return { now: Math.max(now, receivedAt ?? 0), skew };
}

export interface StageProgressProps<S extends ProgressStage> {
  readonly progress: Progress<S>;
  /** 步骤条标题，例如「正在启动 CLI · 档位名」；右侧自动带已用／共用时。 */
  readonly title?: ReactNode;
  /** 段名；默认按启动进度的段种类取文案，档位测试传各段自带的名字。 */
  readonly label?: (stage: S) => string;
  /** 使用方给的按钮（重试、日志页入口）；失败段带日志尾部时，组件自己加「查看日志」开关。 */
  readonly actions?: ReactNode;
  readonly renderExtra?: (stage: S) => ReactNode;
  readonly logLabel?: string;
  /** 给了它，失败而没有留下日志时也显示「查看日志」开关，展开是这句说明（例如容器没有启动）。 */
  readonly emptyLogText?: string;
  readonly className?: string;
}

/**
 * 公共步骤条（RFC-022 D3）：已完成的打勾带用时，当前段带细节与计时，未开始的空心；失败停在那一段标红并写出原因，
 * 仍在重试的问题用警告色。CLI、开发会话与档位测试共用。
 */
export function StageProgress<S extends ProgressStage>({ progress, title, label, actions, renderExtra, logLabel, emptyLogText, className }: StageProgressProps<S>): ReactElement {
  const t = useT(), { now, skew } = useProgressClock(progress), [logOpen, setLogOpen] = useState(false);
  const name = (stage: S) => (label ? label(stage) : stageLabel(t, stage));
  const { index, stage: current } = stagePosition(progress);
  const failed = progress.stages.find((stage) => stage.state === 'failed');
  const logToggle = !!failed && (!!failed.logTail || emptyLogText !== undefined);
  return <section className={[styles.progress, className].filter(Boolean).join(' ')} data-state={progress.state} aria-label={typeof title === 'string' ? title : t('ui.progress.label')}>
    {title !== undefined ? <header className={styles.header}>
      <span className={styles.title}>{title}</span>
      <span className={styles.total}>{t(progress.state === 'running' ? 'ui.progress.elapsed' : 'ui.progress.total', { time: formatDuration(t, totalElapsed(progress, now, skew)) })}</span>
    </header> : null}
    <ol className={styles.stages}>
      {progress.stages.map((stage, i) => {
        const elapsed = stage.state === 'pending' ? undefined : stageElapsed(stage, now, skew), extra = renderExtra ? renderExtra(stage) : null;
        return <li key={`${stage.kind}-${i}`} className={styles.stage} data-state={stage.state} aria-current={progress.state === 'running' && i === index - 1 ? 'step' : undefined}>
          <span className={styles.icon} aria-hidden="true">{ICON[stage.state]}</span>
          <span className={styles.name}>{name(stage)}<span className={styles.hidden}>{`（${t(`ui.progress.state.${stage.state}`)}）`}</span></span>
          <span className={styles.time}>{stage.state === 'skipped' ? t('ui.progress.state.skipped') : elapsed !== undefined ? formatDuration(t, elapsed) : ''}</span>
          {stage.detail && stage.state !== 'pending' ? <p className={styles.detail}>{stage.detail}</p> : null}
          {stage.warning ? <p className={styles.warning}>{stage.warning}</p> : null}
          {stage.error ? <p className={styles.error}>{stage.error.message}</p> : null}
          {stage === failed && logOpen ? (stage.logTail ? <pre className={styles.log} aria-label={logLabel ?? t('ui.progress.log')}>{stage.logTail}</pre> : <p className={styles.detail}>{emptyLogText}</p>) : null}
          {extra !== null && extra !== undefined && extra !== false ? <div className={styles.extra}>{extra}</div> : null}
        </li>;
      })}
    </ol>
    <p className={styles.hidden} aria-live="polite">{progress.state === 'running' && current ? name(current) : t(`ui.progress.overall.${progress.state}`)}</p>
    {actions || logToggle ? <div className={styles.actions}>
      {actions}
      {logToggle ? <Button size="small" aria-expanded={logOpen} onClick={() => setLogOpen((open) => !open)}>{logLabel ?? t('ui.progress.log')}</Button> : null}
    </div> : null}
  </section>;
}

/** 状态条上的一行：启动中「x/共几段 · 段名 · 细节 · 计时」，失败「启动失败 · 段名：原因」；compact 只到段名（页头芯片）。 */
export function StageSummary<S extends ProgressStage>({ progress, label, compact = false }: { readonly progress: Progress<S>; readonly label?: (stage: S) => string; readonly compact?: boolean }): ReactElement {
  const t = useT(), { now, skew } = useProgressClock(progress);
  const { index, total, stage } = stagePosition(progress);
  const name = stage ? (label ? label(stage) : stageLabel(t, stage)) : '';
  if (progress.state === 'failed' && stage) return <span className={styles.summary} data-state="failed">{`${t('ui.progress.overall.failed')} · ${name}${stage.error && !compact ? `：${stage.error.message}` : ''}`}</span>;
  if (progress.state !== 'running' || !stage) return <span className={styles.summary} data-state={progress.state}>{t(`ui.progress.overall.${progress.state}`)}</span>;
  const elapsed = stageElapsed(stage, now, skew);
  const parts = [`${t('ui.progress.overall.running')} ${t('ui.progress.position', { index, total })}`, name, ...(compact ? [] : [stage.warning ?? stage.detail, elapsed === undefined ? undefined : formatDuration(t, elapsed)])];
  return <span className={styles.summary} data-state={stage.warning ? 'warning' : 'running'}>{parts.filter(Boolean).join(' · ')}</span>;
}
