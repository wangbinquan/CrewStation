import { INSTALL_PHASES } from '../cluster/installPlan';
import { reportSucceeded, runPhases, selectPhases } from '../cluster/installReport';
import { operatorContext } from '../cluster/operatorSetup';
import { renderPhaseReports, reportJson, summarize } from '../output/reportOutput';
import { CliFailure } from '../runtime/cliError';
import type { CommandContext } from '../runtime/commandContext';
import { boolFlag, stringFlag } from '../runtime/commandContext';

/**
 * Design §11.4 的安装七步。凡是本仓库还没有的能力（Chart 与镜像管线、发行包 checks/）
 * 都标成“未实现”并说明缺什么，绝不静默跳过、更不谎报成功：整体结论不为成功时退出码是 1。
 */
export async function install(ctx: CommandContext): Promise<void> {
  const operator = operatorContext(ctx, { requireConfig: true, requireBundle: true });
  const phases = selectPhases(INSTALL_PHASES, stringFlag(ctx, 'only'));
  if (!ctx.json) {
    ctx.emit.line(`目标集群：${operator.cluster.target}`);
    ctx.emit.line(`命名空间：${operator.config.namespace}｜模式：${operator.config.profile}｜发行包：${operator.bundle.root}`);
    if (boolFlag(ctx, 'dry-run')) ctx.emit.warn('--dry-run：只做只读预检与计划，不改动集群与平台目录');
  }
  const reports = await runPhases(phases, operator);
  if (ctx.json) ctx.emit.json(reportJson(reports));
  else summarize(ctx.emit, renderPhaseReports(ctx.emit, reports), '安装');
  if (!reportSucceeded(reports)) {
    throw new CliFailure('安装未完成：有阶段是失败、未实现或待配置', ['  逐条见上面的报告；--json 的 outcome 字段是机器可读结论']);
  }
}
