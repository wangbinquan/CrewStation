import type { ProfileTestDto, ProfileTestStage } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { StageProgress } from '../../../../shared/ui/progress/StageProgress';
import type { Progress } from '../../../../shared/ui/progress/stageProgressView';
import { stageLabel } from '../../../../shared/ui/progress/stageProgressView';
import { useProfileTest } from '../../hooks/useProfileTest';
import { testRunning, testTone } from '../../model/profileStatus';
import styles from './ComputeEditor.module.css';

export interface ProfileTestPanelProps {
  readonly name: string;
  /** 详情里的最近一次测试；保存后服务端自动排的测试也从这里出现。 */
  readonly latest: ProfileTestDto | undefined;
  /** 有未保存修改时不能重测：测试绑定的是已保存的修订内容。 */
  readonly dirty: boolean;
  readonly onLocate: (stepId: string) => void;
}

/**
 * 测试时间线（RFC-006 §8，RFC-022 D8 起用公共步骤条）：排队分配容器 → 容器启动中 → 等待连接 → 启动前步骤 → Agent 启动中 →
 * 模型轮次或测试命令；每段给出结论与原因。之前的记录（镜像 → Runner 握手 → … → 启动 CLI）照原名称显示。
 */
export function ProfileTestPanel({ name, latest, dirty, onLocate }: ProfileTestPanelProps): ReactElement {
  const t = useT();
  const test = useProfileTest(name, latest);
  return (
    <div className={styles.sub}>
      <div className={styles.sectionHeading}>
        <h3>{t('admin.profile.section.test')}</h3>
        <Button disabled={dirty || test.running} onClick={() => test.start.mutate(undefined)}>{test.start.isPending ? t('admin.profile.test.starting') : t('admin.profile.test.retest')}</Button>
      </div>
      <p className={styles.hint}>{t('admin.profile.test.hint')}</p>
      {dirty ? <ActionNote tone="neutral">{t('admin.profile.test.needSave')}</ActionNote> : null}
      {test.error ? <ActionNote tone="error">{t('admin.profile.test.error', { message: errorMessage(test.error) })}</ActionNote> : null}
      {test.shown ? <TestResult result={test.shown} onLocate={onLocate} /> : <p className={styles.hint}>{t('admin.profile.test.none')}</p>}
    </div>
  );
}

function TestResult({ result, onLocate }: { readonly result: ProfileTestDto; readonly onLocate: (stepId: string) => void }): ReactElement {
  const t = useT();
  const context = result.context, running = testRunning(result);
  return (
    <div className={styles.stageBody} aria-live="polite">
      <div className={styles.toolbar}>
        <Badge tone={testTone(result.state)}>{t(`admin.profile.test.state.${result.state}`)}</Badge>
        <span className={styles.hint}>{t('admin.profile.test.forRevision', { revision: result.revision, hash: result.contentHash.slice(0, 12), trigger: t(`admin.profile.test.trigger.${result.trigger}`) })}</span>
      </div>
      {!running && result.outcome ? <ActionNote tone={result.outcome === 'passed' ? 'success' : 'error'}>{t(`admin.profile.test.outcome.${result.outcome}`)}</ActionNote> : null}
      {result.state === 'unknown' ? <ActionNote tone="neutral">{t('admin.profile.test.unknownNote')}</ActionNote> : null}
      {result.state === 'superseded' ? <ActionNote tone="neutral">{t('admin.profile.test.supersededNote')}</ActionNote> : null}
      {result.error ? <p className={styles.detail}>{result.error}</p> : null}
      <div className={styles.testContext}>
        <DefinitionList layout="grid" items={[
          { label: t('admin.profile.editor.testId'), value: <code>{result.testId}</code> },
          { label: t('admin.profile.editor.taskId'), value: <code>{context.taskId ?? '—'}</code> },
        ]} />
        <details><summary>{t('admin.profile.editor.testEnvironment')}</summary>
          <DefinitionList items={[
            { label: t('admin.profile.field.image'), value: <code>{context.image ?? '—'}</code> },
            { label: 'Digest', value: <code>{context.imageDigest ?? '—'}</code> },
            { label: t('admin.profile.editor.runner'), value: context.runnerProtocol ?? '—' },
            { label: 'CLI', value: context.cliVersion ?? '—' },
            { label: t('admin.profile.editor.interpreters'), value: (context.interpreters ?? []).map((i) => `${i.language}${i.version ? ` ${i.version}` : ''}`).join(', ') || '—' },
          ]} />
        </details>
      </div>
      <StageProgress progress={testProgress(result)} label={(stage) => (COMMON_KINDS.has(stage.kind) ? stageLabel(t, stage) : stage.name)}
        renderExtra={(stage) => <TestStageExtra stage={stage} onLocate={onLocate} />} />
    </div>
  );
}

/** 公共启动进度的段按统一文案显示；步骤、模型轮次、测试命令与之前记录里的段用自带的名字。 */
const COMMON_KINDS: ReadonlySet<string> = new Set(['queue', 'container', 'connect', 'agent']);

function testProgress(result: ProfileTestDto): Progress<ProfileTestStage> {
  const state = result.state === 'passed' ? 'ready' : result.state === 'failed' || result.state === 'unknown' ? 'failed' : result.state === 'superseded' ? 'cancelled' : 'running';
  return { state, stages: result.stages, startedAt: result.startedAt ?? result.createdAt, ...(result.endedAt ? { endedAt: result.endedAt } : {}) };
}

/** 档位测试特有的内容：定位到步骤、失败归类、退出码、输出尾部。 */
function TestStageExtra({ stage, onLocate }: { readonly stage: ProfileTestStage; readonly onLocate: (stepId: string) => void }): ReactElement | null {
  const t = useT(), log = stage.log && (stage.log.stdoutTail || stage.log.stderrTail) ? [stage.log.stdoutTail, stage.log.stderrTail].filter(Boolean).join('\n') : undefined;
  const hasExit = stage.exitCode !== undefined && stage.exitCode !== null;
  if (!stage.stepId && !stage.error && !hasExit && !log) return null;
  return <div className={styles.stageBody}>
    <div className={styles.toolbar}>
      {stage.error ? <code>{stage.error.code}</code> : null}
      {hasExit ? <span className={styles.hint}>{t('admin.profile.test.exitCode', { code: stage.exitCode! })}</span> : null}
      {stage.stepId ? <Button size="small" onClick={() => onLocate(stage.stepId!)}>{t('admin.profile.test.locate')}</Button> : null}
    </div>
    {log ? <pre className={styles.log} aria-label={t('admin.profile.test.log')}>{log}</pre> : null}
  </div>;
}
