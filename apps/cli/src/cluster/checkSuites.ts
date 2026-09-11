import type { FetchLike } from '@crewstation/api-client';
import { isApiClientError } from '@crewstation/api-client';
import { PLATFORM_PATHS } from '@crewstation/contracts';
import { firstProblem, ok } from './clusterAccess';
import { INSTALL_PHASES } from './installPlan';
import type { CheckLine, OperatorContext } from './installReport';
import { checkLine as line } from './installReport';

/** 常驻服务（Design §3）：verify smoke 逐个看副本是否就绪。 */
export const RESIDENT_SERVICES: readonly string[] = ['cs-api', 'cs-auth', 'cs-controller', 'cs-session', 'cs-events'];

export interface VerifyContext {
  readonly operator: OperatorContext;
  readonly apiUrl: string;
  readonly fetch: FetchLike;
}

export interface CheckSuite {
  readonly id: string;
  readonly title: string;
  run(ctx: VerifyContext): Promise<readonly CheckLine[]>;
}

export const CHECK_SUITES: readonly CheckSuite[] = [
  { id: 'smoke', title: '冒烟：平台起来了没有', run: smokeSuite },
  { id: 'preflight', title: '预检：与 install 第 1 阶段同一套检查', run: async (ctx) => runInstallPreflight(ctx.operator) },
  { id: 'acceptance', title: '真实验收：Design §11.4 第 6 步', run: async () => acceptanceSuite() },
];

export const SUITE_IDS: readonly string[] = CHECK_SUITES.map((suite) => suite.id);

async function runInstallPreflight(operator: OperatorContext): Promise<readonly CheckLine[]> {
  const phase = INSTALL_PHASES.find((item) => item.id === 'preflight');
  return phase === undefined ? [] : phase.run(operator);
}

async function smokeSuite(ctx: VerifyContext): Promise<readonly CheckLine[]> {
  return [
    await platformApiCheck(ctx),
    await residentServicesCheck(ctx.operator),
    await consoleHostCheck(ctx),
    line('服务域源 IP 身份解析', 'not-implemented', '要在集群内发一次服务域请求并核对 x-cs-source-service；CLI 在集群外，跑不了这条（Q21）'),
  ];
}

/**
 * 配了令牌就用 `/v1/me` 探：那条路由经网关的用户 ForwardAuth，一次把路由、身份与 cs-api 都验了。
 * 没有令牌时只能打不带身份的 `/healthz`，401 说明网关在、但这条检查验不到平台自身，算受限。
 */
async function platformApiCheck(ctx: VerifyContext): Promise<CheckLine> {
  const label = '平台 API 健康';
  const client = ctx.operator.client;
  if (client !== undefined) {
    try {
      const me = await client().me.get();
      return line(label, 'ok', `${ctx.apiUrl}/v1/me → ${me.id}`);
    } catch (error) {
      return line(label, 'failed', isApiClientError(error) ? `${ctx.apiUrl}/v1/me → ${error.status} ${error.message}` : String(error));
    }
  }
  const url = `${ctx.apiUrl.replace(/\/$/, '')}${PLATFORM_PATHS.health}`;
  try {
    const response = await ctx.fetch(url, { method: 'GET' });
    if (response.ok) return line(label, 'ok', `${url} → ${response.status}`);
    if (response.status === 401 || response.status === 403) return line(label, 'limited', `${url} → ${response.status}：网关在，但这条路径要身份；配置令牌后重跑`);
    return line(label, 'failed', `${url} → ${response.status}`);
  } catch (error) {
    return line(label, 'failed', `${url} 连不上：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function residentServicesCheck(operator: OperatorContext): Promise<CheckLine> {
  const path = 'jsonpath={range .items[*]}{.metadata.name}={.status.readyReplicas}/{.spec.replicas}{"\\n"}{end}';
  const result = await operator.cluster.run(['-n', operator.config.namespace, 'get', 'deployments', '-o', path]);
  if (!ok(result)) return line('常驻服务副本', 'failed', firstProblem(result));
  const state = new Map(readyByName(result.stdout));
  const missing = RESIDENT_SERVICES.filter((name) => !state.has(name));
  const degraded = RESIDENT_SERVICES.filter((name) => state.get(name) !== undefined && !isReady(state.get(name) ?? ''));
  if (missing.length > 0) return line('常驻服务副本', 'failed', `缺少 ${missing.join('、')}`);
  if (degraded.length > 0) return line('常驻服务副本', 'failed', degraded.map((name) => `${name} ${state.get(name)}`).join('、'));
  return line('常驻服务副本', 'ok', RESIDENT_SERVICES.map((name) => `${name} ${state.get(name)}`).join('、'));
}

/** 控制台注册域能否从这台机器解析并应答；不带身份，因此 401／302 也算路由通。 */
async function consoleHostCheck(ctx: VerifyContext): Promise<CheckLine> {
  const host = ctx.operator.config.consoleHost;
  const url = `http://${host}/`;
  try {
    const response = await ctx.fetch(url, { method: 'GET', redirect: 'manual' });
    return line('控制台注册域路由', 'ok', `${url} → ${response.status}`);
  } catch (error) {
    return line('控制台注册域路由', 'limited', `${url} 从本机不可达（可能只在集群内解析）：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Design §11.4 第 6 步的清单；每一条都要真实集群与一个完整的样例项目，CLI 还编排不了。 */
function acceptanceSuite(): readonly CheckLine[] {
  const items = [
    '管理员代建项目、建仓与样例到 preview 槽',
    '开发会话与并行多 Agent、终端与编辑器',
    '标签发布到待命槽、切流与回退',
    'GitLab 事件经服务域到达样例',
    '参考 APIProxy 经放行表可调',
    '会话释放后再开发',
    '控制面副本故障切换（多节点集群）',
  ];
  return items.map((item) => line(item, 'not-implemented', '需要发行包 checks/ 的验收脚本与真实集群（Plan M6）'));
}

function readyByName(stdout: string): readonly (readonly [string, string])[] {
  return stdout.split('\n').map((row) => row.trim()).filter((row) => row.includes('='))
    .map((row) => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1)] as const);
}

/** jsonpath 在 readyReplicas 缺失时输出空串，`/2` 这种也算未就绪。 */
function isReady(value: string): boolean {
  const [ready, desired] = value.split('/');
  return ready !== undefined && ready.length > 0 && ready === desired && ready !== '0';
}
