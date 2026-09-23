import type { DevSessionDto } from '@crewstation/contracts';
import type { ReactElement, ReactNode } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { StageProgress } from '../../../../shared/ui/progress/StageProgress';

/** 开始开发或重建还在进行、或启动失败时，CLI 区域换成步骤条（RFC-022 D3、D7）；就绪后回到 CLI 区。 */
export const sessionStartupShown = (session: DevSessionDto): boolean => session.startup?.state === 'running' || session.startup?.state === 'failed';

/** 失败在检出代码或更早（工作卷里还没有可用的仓库）：按原分支重新开始开发；失败在等待连接或重建本身失败：打开恢复（Q1）。 */
export const restartsFromScratch = (session: DevSessionDto): boolean => {
  const stages = session.startup?.stages ?? [], failed = stages.find((stage) => stage.state === 'failed');
  return !!failed && !stages.some((stage) => stage.kind === 'replace') && ['queue', 'container', 'checkout'].includes(failed.kind);
};

export interface SessionStartupProps {
  readonly session: DevSessionDto; readonly canDevelop: boolean;
  /** 按原分支重新开始开发（启动失败的会话已不算活动会话，不用先释放）。 */
  readonly onRestart?: () => void;
  /** 打开会话面板里现有的恢复（保留工作卷重建）。 */
  readonly onRecover?: () => void;
  readonly logs?: ReactNode;
}

export function SessionStartup({ session, canDevelop, onRestart, onRecover, logs }: SessionStartupProps): ReactElement | null {
  const t = useT(), startup = session.startup;
  if (!startup || !sessionStartupShown(session)) return null;
  const rebuild = startup.stages.some((stage) => stage.kind === 'replace'), failed = startup.state === 'failed';
  const restart = restartsFromScratch(session), retry = canDevelop && failed ? (restart ? onRestart : onRecover) : undefined;
  const title = t(`devSession.startup.${rebuild ? 'rebuild' : 'create'}${failed ? 'Failed' : ''}`, { branch: session.branch });
  return <StageProgress progress={startup} title={title} actions={<>
    {retry ? <Button variant="primary" size="small" title={t(restart ? 'devSession.startup.restartHint' : 'devSession.startup.recoverHint')} onClick={retry}>{t('devSession.startup.retry')}</Button> : null}
    {logs}
  </>} />;
}
