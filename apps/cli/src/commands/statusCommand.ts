import { firstProblem, ok } from '../cluster/clusterAccess';
import { operatorContext } from '../cluster/operatorSetup';
import { dash } from '../output/formatValue';
import type { CommandContext } from '../runtime/commandContext';
import type { SettingSource } from '../runtime/settings';

const SOURCE_LABEL: Readonly<Record<SettingSource, string>> = {
  flag: '命令行标志', env: '环境变量', file: '配置文件', default: '内置默认值', unset: '未设置',
};

interface DeploymentRow {
  readonly name: string;
  readonly desired: number;
  readonly ready: number;
  readonly updated: number;
  readonly image: string;
}

/** 平台当前状态：常驻服务副本 + 本次用的配置来源。令牌只报“是否已配置”，永不回显取值。 */
export async function status(ctx: CommandContext): Promise<void> {
  const operator = operatorContext(ctx, { requireConfig: false, requireBundle: false });
  const result = await operator.cluster.run(['-n', operator.config.namespace, 'get', 'deployments', '-o', 'json']);
  const rows = ok(result) ? deploymentRows(result.stdout) : [];
  const problem = ok(result) ? undefined : firstProblem(result);
  const config = {
    apiUrl: ctx.settings.apiUrl,
    apiUrlSource: ctx.settings.sources.apiUrl,
    tokenConfigured: ctx.settings.token !== undefined,
    tokenSource: ctx.settings.sources.token,
    kubeContextSource: ctx.settings.sources.kubeContext,
    configFilePath: ctx.settings.configFilePath,
    configFileFound: ctx.settings.configFileFound,
  };
  if (ctx.json) return ctx.emit.json({ namespace: operator.config.namespace, cluster: operator.cluster.target, deployments: rows, config, problem });
  renderHuman(ctx, operator.config.namespace, operator.cluster.target, rows, problem);
}

function renderHuman(ctx: CommandContext, namespace: string, target: string, rows: readonly DeploymentRow[], problem: string | undefined): void {
  ctx.emit.line(`集群：${target}｜命名空间：${namespace}`);
  ctx.emit.line(`平台 API：${ctx.settings.apiUrl}（来源：${SOURCE_LABEL[ctx.settings.sources.apiUrl]}）`);
  ctx.emit.line(`令牌：${ctx.settings.token === undefined ? '未配置' : `已配置（来源：${SOURCE_LABEL[ctx.settings.sources.token]}）`}`);
  ctx.emit.line(`配置文件：${ctx.settings.configFilePath}${ctx.settings.configFileFound ? '' : '（不存在）'}`);
  ctx.emit.line();
  if (problem !== undefined) {
    ctx.emit.warn('读不到集群里的 Deployment：' + problem);
    return;
  }
  ctx.emit.table(['服务', '就绪', '期望', '已更新', '镜像'], rows.map((row) => [row.name, String(row.ready), String(row.desired), String(row.updated), dash(row.image)]));
}

/** 只取报告要用的几个字段；kubectl 的 JSON 其余部分不进 CLI 的类型系统。 */
function deploymentRows(stdout: string): readonly DeploymentRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return [];
  }
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.map(deploymentRow).sort((left, right) => left.name.localeCompare(right.name));
}

function deploymentRow(item: unknown): DeploymentRow {
  const node = item as { metadata?: { name?: unknown }; spec?: { replicas?: unknown; template?: { spec?: { containers?: unknown } } }; status?: { readyReplicas?: unknown; updatedReplicas?: unknown } };
  const containers = node.spec?.template?.spec?.containers;
  const first = Array.isArray(containers) ? (containers[0] as { image?: unknown } | undefined) : undefined;
  return {
    name: typeof node.metadata?.name === 'string' ? node.metadata.name : '?',
    desired: count(node.spec?.replicas),
    ready: count(node.status?.readyReplicas),
    updated: count(node.status?.updatedReplicas),
    image: typeof first?.image === 'string' ? first.image : '',
  };
}

function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}
