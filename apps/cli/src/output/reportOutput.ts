import type { PhaseReport, StepOutcome } from '../cluster/installReport';
import { OUTCOME_LABEL, phaseOutcome, worstOutcome } from '../cluster/installReport';
import type { Emitter } from './emit';

/** Design §11.7 的结果报告：逐阶段列检查，再给一张总表，最后一行是整体结论。 */
export function renderPhaseReports(emit: Emitter, reports: readonly PhaseReport[]): StepOutcome {
  for (const report of reports) {
    emit.line();
    emit.line(`【${report.title}】${OUTCOME_LABEL[phaseOutcome(report)]}`);
    emit.table(['检查', '结果', '说明'], report.checks.map((check) => [check.label, OUTCOME_LABEL[check.outcome], check.detail]));
  }
  const overall = worstOutcome(reports.map(phaseOutcome));
  emit.line();
  emit.line('【结果汇总】');
  emit.table(['阶段', '结果', '检查数'], reports.map((report) => [report.title, OUTCOME_LABEL[phaseOutcome(report)], String(report.checks.length)]));
  return overall;
}

/** --json：阶段、检查与结论都用稳定的机器名，脚本据此判断，不必解析中文。 */
export function reportJson(reports: readonly PhaseReport[]): Record<string, unknown> {
  return {
    outcome: worstOutcome(reports.map(phaseOutcome)),
    phases: reports.map((report) => ({
      id: report.id,
      title: report.title,
      outcome: phaseOutcome(report),
      checks: report.checks.map((check) => ({ label: check.label, outcome: check.outcome, detail: check.detail })),
    })),
  };
}

/** 未实现与待配置也要在终端里显眼，不能让人以为装完了。 */
export function summarize(emit: Emitter, overall: StepOutcome, done: string): void {
  const text = `${done}：${OUTCOME_LABEL[overall]}`;
  if (overall === 'ok' || overall === 'limited' || overall === 'skipped') emit.success(text);
  else emit.warn(text);
}
