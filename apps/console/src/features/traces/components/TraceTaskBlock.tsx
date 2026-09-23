import type { TraceExecutionDto, TraceSubtaskDto, TraceTaskDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useDateText } from '../../../shared/lib/useDateText';
import { useT } from '../../../shared/lib/useT';
import { PROJECT_PATHS } from '../../../shared/project/projectPaths';
import { useProjectScope } from '../../../shared/project/ProjectScope';
import { ActionRow } from '../../../shared/ui/ActionRow';
import { Badge } from '../../../shared/ui/Badge';
import { ButtonLink } from '../../../shared/ui/navigation/ButtonLink';
import { spanText, statusTone, userLabel } from '../model/traceView';
import { TraceExecutionNode } from './TraceExecutionNode';
import styles from './Trace.module.css';

interface TraceTaskBlockProps {
  readonly projectId: string;
  readonly traceId: string;
  readonly task: TraceTaskDto;
  readonly names: ReadonlyMap<string, string>;
}

/**
 * 链上的一个任务：开发会话下直接挂各个 CLI 与 headless Agent；业务任务下挂子任务（每次尝试一行），
 * 子任务的 Agent 执行挂在它自己下面。进行中的任务给「日志」（与开发会话的「打开开发页」）入口。
 */
export function TraceTaskBlock({ projectId, traceId, task, names }: TraceTaskBlockProps): ReactElement {
  const t = useT(), dateText = useDateText(), { space } = useProjectScope();
  const title = t(task.kind === 'dev-session' ? 'traces.task.devSession' : 'traces.task.business');
  const creator = userLabel(names, task.createdBy, t);
  const facts = [
    spanText(task.createdAt, task.endedAt, dateText, t),
    task.business ? t(`traces.businessState.${task.business.state}`) : t(`traces.taskState.${task.state}`),
    ...(creator ? [t('traces.task.createdBy', { user: creator })] : []),
    ...(task.business ? [t('traces.task.caller', { caller: task.business.callerIdentity })] : []),
    ...(task.branch ? [t('traces.row.branch', { branch: task.branch })] : []),
  ];
  const linked = new Set(task.subtasks.flatMap((s) => (s.executionTaskId ? [s.executionTaskId] : [])));
  const loose = task.executions.filter((x) => !linked.has(x.taskId));
  const node = (x: TraceExecutionDto) => <TraceExecutionNode key={x.taskId} projectId={projectId} traceId={traceId} execution={x} />;
  return <section className={styles.section} aria-label={title}>
    <div className={styles.head}>
      <h3 className={styles.headTitle}>{title}</h3>
      <Badge tone={statusTone(task.status)}>{t(`traces.status.${task.status}`)}</Badge>
    </div>
    <p className={styles.facts}>{facts.map((fact) => <span key={fact} className={styles.factPart}>{fact}</span>)}</p>
    {task.message && task.status === 'failed' ? <p className={styles.error}>{task.message}</p> : null}
    {task.status === 'running' ? <ActionRow>
      <ButtonLink size="small" to={PROJECT_PATHS[space].operations} params={{ projectId }} search={{ tab: 'logs', source: task.kind === 'dev-session' ? 'dev-session' : 'business-task', taskId: task.taskId }}>{t('traces.task.logs')}</ButtonLink>
      {task.kind === 'dev-session' ? <ButtonLink size="small" to={PROJECT_PATHS[space].development} params={{ projectId }}>{t('traces.task.openDev')}</ButtonLink> : null}
    </ActionRow> : null}
    {task.subtasks.length === 0 && task.executions.length === 0 ? <p className={styles.muted}>{t('traces.task.noExecutions')}</p> : null}
    {task.subtasks.length > 0 || loose.length > 0 ? <ul className={styles.tree}>
      {task.subtasks.map((subtask) => <TraceSubtaskNode key={subtask.subtaskId} subtask={subtask} execution={task.executions.find((x) => x.taskId === subtask.executionTaskId)} render={node} />)}
      {loose.map(node)}
    </ul> : null}
  </section>;
}

function TraceSubtaskNode({ subtask, execution, render }: { readonly subtask: TraceSubtaskDto; readonly execution: TraceExecutionDto | undefined; readonly render: (x: TraceExecutionDto) => ReactElement }): ReactElement {
  const t = useT(), dateText = useDateText();
  const tone = subtask.state === 'failed' ? 'danger' : subtask.state === 'succeeded' ? 'success' : subtask.state === 'cancelled' ? 'neutral' : 'info';
  return <li className={styles.node}>
    <div className={styles.nodeLine}>
      <span className={styles.nodeTitle}>{t('traces.subtask.title', { name: subtask.name })}</span>
      <Badge tone={tone}>{t(`traces.subtaskState.${subtask.state}`)}</Badge>
    </div>
    <p className={styles.facts}>
      <span className={styles.factPart}>{t('traces.subtask.attempt', { count: subtask.attempt })}</span>
      {subtask.kind === 'command' ? <span className={styles.factPart}>{t('traces.subtask.command')}</span> : null}
      {subtask.agentProfileName ? <span className={styles.factPart}>{subtask.agentProfileName}</span> : null}
      <span className={styles.factPart}>{spanText(subtask.createdAt, subtask.endedAt, dateText, t)}</span>
    </p>
    {subtask.error ? <p className={styles.error}>{subtask.error}</p> : null}
    {execution ? <ul className={styles.tree}>{render(execution)}</ul> : null}
  </li>;
}
