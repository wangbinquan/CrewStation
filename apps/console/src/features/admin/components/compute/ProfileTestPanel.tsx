import type { ProfileTestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { errorMessage } from '../../../../shared/api/useApi';
import { useT } from '../../../../shared/lib/useT';
import { ActionNote } from '../../../../shared/ui/ActionNote';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { useProfileTest } from '../../hooks/useProfileTest';
import { shortDigest, stageTone, testRunning, testTone } from '../../model/profileStatus';
import styles from './ComputeEditor.module.css';

export interface ProfileTestPanelProps {
  readonly name: string;
  /** 详情里的最近一次测试；保存后服务端自动排的测试也从这里出现。 */
  readonly latest: ProfileTestDto | undefined;
  /** 有未保存修改时不能重测：测试绑定的是已保存的修订内容。 */
  readonly dirty: boolean;
  readonly onLocate: (stepId: string) => void;
}

/** 测试时间线（RFC-006 §8）：镜像 → Runner 握手 → 启动前步骤 → CLI 启动 → 模型轮次或测试命令；每段给出结论与原因。 */
export function ProfileTestPanel({ name, latest, dirty, onLocate }: ProfileTestPanelProps): ReactElement {
  const t = useT();
  const test = useProfileTest(name, latest);
  return (
    <div className={styles.sub}>
      <h3>{t('admin.profile.section.test')}</h3>
      <p className={styles.hint}>{t('admin.profile.test.hint')}</p>
      <div className={styles.toolbar}>
        <Button variant="primary" disabled={dirty || test.running} onClick={() => test.start.mutate(undefined)}>{test.start.isPending ? t('admin.profile.test.starting') : t('admin.profile.test.retest')}</Button>
        {dirty ? <span className={styles.hint}>{t('admin.profile.test.needSave')}</span> : null}
      </div>
      {test.error ? <ActionNote tone="error">{t('admin.profile.test.error', { message: errorMessage(test.error) })}</ActionNote> : null}
      {test.shown ? <TestResult result={test.shown} onLocate={onLocate} /> : <p className={styles.hint}>{t('admin.profile.test.none')}</p>}
    </div>
  );
}

function TestResult({ result, onLocate }: { readonly result: ProfileTestDto; readonly onLocate: (stepId: string) => void }): ReactElement {
  const t = useT();
  const context = result.context, running = testRunning(result);
  const interpreters = (context.interpreters ?? []).map((i) => `${i.language}${i.version ? ` ${i.version}` : ''}`).join(', ') || '—';
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
      {context.taskId || context.image ? (
        <p className={styles.hint} title={context.imageDigest}>{t('admin.profile.test.context', { image: context.image ?? '—', digest: context.imageDigest ? `@${shortDigest(context.imageDigest)}` : '', runner: context.runnerProtocol ?? '—', cli: context.cliVersion ?? '—', interpreters, taskId: context.taskId ?? '—' })}</p>
      ) : null}
      <ol className={styles.timeline}>
        {result.stages.map((stage) => (
          <li key={stage.id} className={styles.stage}>
            <Badge tone={stageTone(stage.state)}>{t(`admin.profile.test.stageState.${stage.state}`)}</Badge>
            <div className={styles.stageBody}>
              <div className={styles.toolbar}>
                <span className={styles.hint}>{t(`admin.profile.test.stageKind.${stage.kind}`)}</span>
                <strong>{stage.name}</strong>
                {stage.durationMs !== undefined ? <span className={styles.hint}>{t('admin.profile.test.duration', { ms: stage.durationMs })}</span> : null}
                {stage.exitCode !== undefined && stage.exitCode !== null ? <span className={styles.hint}>{t('admin.profile.test.exitCode', { code: stage.exitCode })}</span> : null}
                {stage.stepId ? <Button variant="ghost" onClick={() => onLocate(stage.stepId!)}>{t('admin.profile.test.locate')}</Button> : null}
              </div>
              {stage.detail ? <p className={styles.detail}>{stage.detail}</p> : null}
              {stage.error ? <p className={styles.detail}><code>{stage.error.code}</code> {stage.error.message}</p> : null}
              {stage.log && (stage.log.stdoutTail || stage.log.stderrTail) ? <pre className={styles.log} aria-label={t('admin.profile.test.log')}>{[stage.log.stdoutTail, stage.log.stderrTail].filter(Boolean).join('\n')}</pre> : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
