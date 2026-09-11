import type { ClusterAccess } from './clusterAccess';
import { firstProblem, ok } from './clusterAccess';
import type { CheckLine, OperatorContext, OperatorPhase } from './installReport';
import { checkLine as line } from './installReport';
import { join } from './releaseBundle';

/**
 * 滚动顺序（Design §12.2）：先滚无状态的服务，再滚靠租约交接的 cs-controller，
 * 最后滚要排空 TaskRunner 连接的 cs-session，让重连尽量落在已经是新版本的副本上。
 */
export const UPGRADE_ORDER: readonly string[] = ['cs-auth', 'cs-api', 'cs-events', 'console', 'mcp-capabilities', 'mcp-operations', 'cs-controller', 'cs-session'];

const ROLLOUT_TIMEOUT = '--timeout=180s';

export const UPGRADE_PHASES: readonly OperatorPhase[] = [
  { id: 'preflight', title: '1 升级预检', run: upgradePreflight },
  { id: 'migrate', title: '2 扩展迁移', run: expandMigration },
  { id: 'rollout', title: '3 滚动各服务副本', run: rollingRestart },
  { id: 'continuity', title: '4 放行表与身份索引连续性', run: async () => [continuityCheck()] },
  { id: 'keys', title: '5 签名密钥轮换重叠期', run: async () => [keyOverlapCheck()] },
];

export const UPGRADE_PHASE_IDS: readonly string[] = UPGRADE_PHASES.map((phase) => phase.id);

async function upgradePreflight(ctx: OperatorContext): Promise<readonly CheckLine[]> {
  const version = await ctx.cluster.run(['version', '-o', 'json']);
  if (!ok(version)) return [line('集群可达', 'failed', firstProblem(version))];
  const checks: CheckLine[] = [line('集群可达', 'ok', ctx.cluster.target)];
  checks.push(ctx.bundle.version === undefined
    ? line('目标版本', 'pending-config', '发行包没有 release.lock.yaml 或其中没有 version')
    : line('目标版本', 'ok', `${ctx.bundle.version}${ctx.bundle.images.length > 0 ? `，${ctx.bundle.images.length} 个镜像` : ''}`));
  checks.push(await installedDeployments(ctx));
  checks.push(line('依赖兼容与在途资源', 'not-implemented', '网关、数据库 Operator 与 CRD 走各自的发布流程（Design §12.1），CLI 不检查它们的兼容矩阵'));
  return checks;
}

async function installedDeployments(ctx: OperatorContext): Promise<CheckLine> {
  const result = await ctx.cluster.run(['-n', ctx.config.namespace, 'get', 'deployments', '-o', 'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']);
  if (!ok(result)) return line('已安装的服务', 'failed', firstProblem(result));
  const names = deploymentNames(result.stdout);
  if (names.length === 0) return line('已安装的服务', 'failed', `命名空间 ${ctx.config.namespace} 里没有 Deployment；先执行 install`);
  return line('已安装的服务', 'ok', names.join('、'));
}

/**
 * 先做新旧版本都能读取的扩展迁移。迁移作业的清单由发行包提供（migrations/job.yaml）；
 * 本仓库的发行包还不存在，缺文件时如实报未实现，而不是跳过。
 */
async function expandMigration(ctx: OperatorContext): Promise<readonly CheckLine[]> {
  const manifest = join(ctx.bundle.root, 'migrations/job.yaml');
  if (!ctx.files.exists(manifest)) {
    return [line('扩展迁移', 'not-implemented', `发行包缺 ${manifest}；迁移作业清单由发行包提供（Design §11.2 migrations/）`)];
  }
  if (ctx.dryRun) return [line('扩展迁移', 'skipped', `--dry-run：将 apply ${manifest} 并等待作业完成`)];
  const applied = await ctx.cluster.run(['-n', ctx.config.namespace, 'apply', '-f', manifest]);
  if (!ok(applied)) return [line('扩展迁移', 'failed', firstProblem(applied))];
  const waited = await ctx.cluster.run(['-n', ctx.config.namespace, 'wait', '--for=condition=complete', 'job/crewstation-migrate', ROLLOUT_TIMEOUT]);
  return [ok(waited) ? line('扩展迁移', 'ok', '迁移作业完成') : line('扩展迁移', 'failed', firstProblem(waited))];
}

async function rollingRestart(ctx: OperatorContext): Promise<readonly CheckLine[]> {
  const present = await ctx.cluster.run(['-n', ctx.config.namespace, 'get', 'deployments', '-o', 'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}']);
  if (!ok(present)) return [line('滚动副本', 'failed', firstProblem(present))];
  const names = new Set(deploymentNames(present.stdout));
  const checks: CheckLine[] = [];
  for (const name of UPGRADE_ORDER) {
    if (!names.has(name)) {
      checks.push(line(name, 'skipped', '命名空间里没有这个 Deployment'));
      continue;
    }
    checks.push(ctx.dryRun ? line(name, 'skipped', '--dry-run：将 rollout restart 并等待就绪') : await restartOne(ctx.cluster, ctx.config.namespace, name));
  }
  return checks;
}

async function restartOne(access: ClusterAccess, namespace: string, name: string): Promise<CheckLine> {
  const restarted = await access.run(['-n', namespace, 'rollout', 'restart', `deployment/${name}`]);
  if (!ok(restarted)) return line(name, 'failed', firstProblem(restarted));
  const status = await access.run(['-n', namespace, 'rollout', 'status', `deployment/${name}`, ROLLOUT_TIMEOUT]);
  return ok(status) ? line(name, 'ok', status.stdout.trim().split('\n').pop() ?? '已就绪') : line(name, 'failed', firstProblem(status));
}

function continuityCheck(): CheckLine {
  return line('放行表与身份索引版本连续', 'not-implemented', 'cs-api 还没有回读网关下发版本的路由；Design §12.2 要求升级期间版本号连续且不回退');
}

function keyOverlapCheck(): CheckLine {
  return line('签名密钥重叠期', 'not-implemented', '轮换重叠期由 cs-auth 维护，平台 API 尚未暴露查询（Design §12.2）');
}

function deploymentNames(stdout: string): readonly string[] {
  return stdout.split('\n').map((item) => item.trim()).filter((item) => item.length > 0);
}
