import type { ApiClient } from '@crewstation/api-client';
import { UsageError } from '../runtime/cliError';
import type { FileAccess } from '../runtime/commandContext';
import type { ClusterAccess } from './clusterAccess';
import type { InstallConfig } from './installConfig';
import type { ReleaseBundle } from './releaseBundle';

/** Design §11.7 要求区分成功、受限、待配置、失败；另加“未实现”，用来标记本仓库还没有的能力。 */
export type StepOutcome = 'ok' | 'limited' | 'pending-config' | 'not-implemented' | 'failed' | 'skipped';

export const OUTCOME_LABEL: Readonly<Record<StepOutcome, string>> = {
  ok: '成功', limited: '受限', 'pending-config': '待配置', 'not-implemented': '未实现', failed: '失败', skipped: '跳过',
};

/** 由坏到好；worstOutcome 取下标最小的。 */
const SEVERITY: readonly StepOutcome[] = ['failed', 'not-implemented', 'pending-config', 'limited', 'ok', 'skipped'];

export interface CheckLine {
  readonly label: string;
  readonly outcome: StepOutcome;
  readonly detail: string;
}

export interface PhaseReport {
  readonly id: string;
  readonly title: string;
  readonly checks: readonly CheckLine[];
}

export interface OperatorContext {
  readonly config: InstallConfig;
  readonly bundle: ReleaseBundle;
  readonly cluster: ClusterAccess;
  readonly files: FileAccess;
  /** 只有配了令牌才有；初始化阶段要经平台 API 写目录。 */
  readonly client: (() => ApiClient) | undefined;
  readonly dryRun: boolean;
}

export interface OperatorPhase {
  readonly id: string;
  readonly title: string;
  run(ctx: OperatorContext): Promise<readonly CheckLine[]>;
}

export function checkLine(label: string, outcome: StepOutcome, detail: string): CheckLine {
  return { label, outcome, detail };
}

export function worstOutcome(outcomes: readonly StepOutcome[]): StepOutcome {
  let worst: StepOutcome = 'skipped';
  for (const outcome of outcomes) if (SEVERITY.indexOf(outcome) < SEVERITY.indexOf(worst)) worst = outcome;
  return worst;
}

export function phaseOutcome(report: PhaseReport): StepOutcome {
  return worstOutcome(report.checks.map((check) => check.outcome));
}

/** 只有每个阶段都落在成功／受限／跳过时才算装完；未实现与待配置都不能报成功。 */
export function reportSucceeded(reports: readonly PhaseReport[]): boolean {
  const worst = worstOutcome(reports.map(phaseOutcome));
  return worst === 'ok' || worst === 'limited' || worst === 'skipped';
}

/** 阶段按顺序串行执行：后一阶段的前提是前一阶段的产物，不能并发。 */
/**
 * 预检有失败项（例如网络插件不执行 NetworkPolicy，D60）时，后面的阶段一律不执行、记为跳过，整体结论仍是失败。
 * 待配置与未实现的预检项不拦：它们说明的是本仓库或配置的缺口，不是集群不满足前提。
 */
export async function runPhases(phases: readonly OperatorPhase[], ctx: OperatorContext): Promise<readonly PhaseReport[]> {
  const reports: PhaseReport[] = [];
  for (const phase of phases) {
    const blocked = reports.some((report) => report.id === 'preflight' && phaseOutcome(report) === 'failed');
    const checks = blocked ? [checkLine('未执行', 'skipped', '预检有失败项，这一阶段不执行')] : await phase.run(ctx);
    reports.push({ id: phase.id, title: phase.title, checks });
  }
  return reports;
}

/** --only 逗号分隔若干阶段 ID；写错的 ID 是用法错误，顺便把可选值列出来。 */
export function selectPhases(phases: readonly OperatorPhase[], only: string | undefined): readonly OperatorPhase[] {
  if (only === undefined) return phases;
  const wanted = only.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
  const unknown = wanted.filter((id) => !phases.some((phase) => phase.id === id));
  if (unknown.length > 0) throw new UsageError(`--only 里有未知阶段：${unknown.join('、')}`, `  可选阶段：${phases.map((phase) => phase.id).join('、')}`);
  return phases.filter((phase) => wanted.includes(phase.id));
}
