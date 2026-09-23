import type { ClusterAccess } from './clusterAccess';
import { firstProblem, ok } from './clusterAccess';
import type { InstallConfig } from './installConfig';
import { initializePlatform } from './installInitialize';
import type { CheckLine, OperatorContext, OperatorPhase } from './installReport';
import { checkLine as line } from './installReport';
import { networkPolicyCheck } from './networkPolicyProbe';
import type { ReleaseBundle } from './releaseBundle';

/** Design §11.4 的七个阶段；第 7 步“结果报告”由 installCommand 渲染，不是一个执行阶段。 */
export const INSTALL_PHASES: readonly OperatorPhase[] = [
  { id: 'preflight', title: '1 预检与计划', run: preflight },
  { id: 'base', title: '2 基础组件', run: async (ctx) => [chartPhase(ctx, 'CRD 与 Controller、日志采集')] },
  { id: 'data', title: '3 数据底座', run: async (ctx) => [chartPhase(ctx, '平台与业务 PostgreSQL、对象存储、registry')] },
  { id: 'platform', title: '4 平台应用', run: async (ctx) => [chartPhase(ctx, '网关、五个常驻服务、两个 MCP、任务容器镜像与带锁迁移任务')] },
  { id: 'initialize', title: '5 初始化', run: initializePlatform },
  { id: 'acceptance', title: '6 真实验收', run: async () => [acceptanceCheck()] },
];

export const INSTALL_PHASE_IDS: readonly string[] = INSTALL_PHASES.map((phase) => phase.id);

/**
 * 2～4 阶段要把发行包的 charts 与镜像装进集群。本仓库还没有发行包与 Chart 管线
 *（deploy/ 下只有本机 kind 的 kubectl 清单，安装器是 Plan M6 的任务），所以如实报未实现，
 * 同时说明发行包里是否已有素材，方便判断缺口。
 */
function chartPhase(ctx: OperatorContext, what: string): CheckLine {
  const hasCharts = ctx.bundle.entries.some((entry) => entry.path === 'charts' && entry.present);
  const state = hasCharts ? '发行包有 charts/，但 CLI 还没有 Chart 执行器' : '发行包没有 charts/';
  return line('应用 Chart 与镜像', 'not-implemented', `${what}；需要发行包 charts/ 与 images/ 的安装管线（Plan M6）。${state}`);
}

function acceptanceCheck(): CheckLine {
  return line('真实验收', 'not-implemented', '代建项目、样例到 preview 槽、开发会话、标签发布、切流与回退、事件到达、副本故障切换需要发行包 checks/ 与真实集群（Plan M6 的 AT 用例）');
}

async function preflight(ctx: OperatorContext): Promise<readonly CheckLine[]> {
  const checks: CheckLine[] = [];
  const reachable = await clusterReachable(ctx.cluster);
  checks.push(reachable);
  if (reachable.outcome !== 'failed') {
    checks.push(await contextCheck(ctx.cluster));
    checks.push(await namespaceCheck(ctx.cluster, ctx.config.namespace));
    checks.push(await storageClassCheck(ctx.cluster));
  }
  checks.push(bundleCheck(ctx.bundle));
  checks.push(sourceIpCheck(ctx.config));
  if (reachable.outcome !== 'failed') checks.push(await networkPolicyCheck(ctx));
  checks.push(line('源码托管建仓、推送与保护标签资格', 'not-implemented', `需要以 ${ctx.config.sourceControlBaseUrl} 的凭据实测建仓与打标签；安装器尚未接管 SCM 预检`));
  return checks;
}

async function clusterReachable(cluster: ClusterAccess): Promise<CheckLine> {
  const result = await cluster.run(['version', '-o', 'json']);
  return ok(result) ? line('集群可达', 'ok', `${cluster.target} 应答正常`) : line('集群可达', 'failed', firstProblem(result));
}

async function contextCheck(cluster: ClusterAccess): Promise<CheckLine> {
  const result = await cluster.run(['config', 'current-context']);
  const context = result.stdout.trim();
  if (!ok(result) || context.length === 0) return line('kubectl 上下文', 'pending-config', '取不到当前上下文；用 --kube-context 明确指定');
  return line('kubectl 上下文', 'ok', context);
}

async function namespaceCheck(cluster: ClusterAccess, namespace: string): Promise<CheckLine> {
  const result = await cluster.run(['get', 'namespace', namespace, '-o', 'name']);
  return ok(result) ? line('命名空间', 'ok', `${namespace} 已存在`) : line('命名空间', 'pending-config', `${namespace} 不存在，安装时创建`);
}

const DEFAULT_CLASS_JSONPATH = 'jsonpath={range .items[*]}{.metadata.name}={.metadata.annotations.storageclass\\.kubernetes\\.io/is-default-class}{"\\n"}{end}';

async function storageClassCheck(cluster: ClusterAccess): Promise<CheckLine> {
  const result = await cluster.run(['get', 'storageclass', '-o', DEFAULT_CLASS_JSONPATH]);
  if (!ok(result)) return line('默认 StorageClass', 'pending-config', firstProblem(result));
  const found = result.stdout.split('\n').map((item) => item.trim()).find((item) => item.endsWith('=true'));
  if (found === undefined) return line('默认 StorageClass', 'pending-config', '没有默认 StorageClass；任务容器与数据库都要块存储');
  return line('默认 StorageClass', 'ok', found.replace('=true', ''));
}

function bundleCheck(bundle: ReleaseBundle): CheckLine {
  if (bundle.missing.length > 0) return line('发行包内容', 'pending-config', `缺少 ${bundle.missing.join('、')}`);
  return line('发行包内容', 'ok', `${bundle.root}${bundle.version === undefined ? '' : `，版本 ${bundle.version}`}`);
}

/** CNI 是否在 Pod → 网关路径上保留源 IP 是 Q21 的前提；实测要下发探针负载，CLI 还没有这条路径。 */
function sourceIpCheck(config: InstallConfig): CheckLine {
  const declared = config.sourceIpPreserved ? '配置声明为 true' : '配置声明为 false';
  return line('CNI 保留源 IP（Q21）', 'not-implemented', `${declared}；实测需在集群内下发探针负载并比对 X-Forwarded-For，参考 deploy/local/verify.sh 的检查 C`);
}

