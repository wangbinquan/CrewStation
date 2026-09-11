import { reportSucceeded, runPhases, selectPhases } from '../cluster/installReport';
import { operatorContext } from '../cluster/operatorSetup';
import { UPGRADE_ORDER, UPGRADE_PHASES } from '../cluster/upgradePlan';
import { renderPhaseReports, reportJson, summarize } from '../output/reportOutput';
import { CliFailure } from '../runtime/cliError';
import type { CommandContext } from '../runtime/commandContext';
import { boolFlag, stringFlag } from '../runtime/commandContext';

/**
 * Design §12.2：先做新旧版本都能读取的扩展迁移，再按固定顺序滚动各服务副本。
 * 回退只覆盖框架管理的资源，不回滚业务数据，所以这里不提供 downgrade 子命令。
 */
export async function upgrade(ctx: CommandContext): Promise<void> {
  const operator = operatorContext(ctx, { requireConfig: true, requireBundle: true });
  const phases = selectPhases(UPGRADE_PHASES, stringFlag(ctx, 'only'));
  if (!ctx.json) {
    ctx.emit.line(`目标集群：${operator.cluster.target}｜命名空间：${operator.config.namespace}`);
    ctx.emit.line(`发行包：${operator.bundle.root}${operator.bundle.version === undefined ? '' : `（版本 ${operator.bundle.version}）`}`);
    ctx.emit.note('滚动顺序：' + UPGRADE_ORDER.join(' → '));
    if (boolFlag(ctx, 'dry-run')) ctx.emit.warn('--dry-run：只做预检，不执行迁移与滚动');
  }
  const reports = await runPhases(phases, operator);
  if (ctx.json) ctx.emit.json(reportJson(reports));
  else summarize(ctx.emit, renderPhaseReports(ctx.emit, reports), '升级');
  if (!reportSucceeded(reports)) {
    throw new CliFailure('升级未完成：有步骤是失败、未实现或待配置', ['  运行中的任务容器不会换镜像，新任务才用新镜像（Design §12.4）']);
  }
}
