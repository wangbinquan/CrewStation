import { SUITE_IDS } from '../cluster/checkSuites';
import { INSTALL_PHASE_IDS } from '../cluster/installPlan';
import { UPGRADE_PHASE_IDS } from '../cluster/upgradePlan';
import { listConfig } from '../commands/configCommands';
import { whoami } from '../commands/identityCommands';
import { install } from '../commands/installCommand';
import { listBranches, listProjects, showProject } from '../commands/projectCommands';
import { listReleases, publish, showRelease, showTraffic, switchTraffic, trafficHistory } from '../commands/releaseCommands';
import { releaseSession, openSession, showSession } from '../commands/sessionCommands';
import { status } from '../commands/statusCommand';
import { upgrade } from '../commands/upgradeCommand';
import { verify } from '../commands/verifyCommand';
import type { CommandContext } from './commandContext';

export interface FlagSpec {
  /** 长标志名，不含 `--`。 */
  readonly name: string;
  readonly type: 'string' | 'boolean';
  readonly short?: string;
  readonly summary: string;
  /** string 标志在帮助里的占位符。 */
  readonly placeholder?: string;
}

export interface ArgSpec {
  readonly name: string;
  readonly summary: string;
}

export interface CommandSpec {
  /** 一或两个词，例如 `publish`、`projects list`。 */
  readonly name: string;
  readonly group: string;
  readonly summary: string;
  readonly args: readonly ArgSpec[];
  readonly flags: readonly FlagSpec[];
  /** 产出 DTO 的命令自动获得 --json；帮助与解析都从这里取，不会出现“帮助有、实现没有”。 */
  readonly emitsDto: boolean;
  run(ctx: CommandContext): Promise<void>;
}

export const JSON_FLAG: FlagSpec = { name: 'json', type: 'boolean', summary: '原样输出服务端 DTO，便于脚本处理' };

export const GLOBAL_FLAGS: readonly FlagSpec[] = [
  { name: 'api', type: 'string', placeholder: 'url', summary: '平台 API 地址' },
  { name: 'token', type: 'string', placeholder: 'token', summary: '平台令牌；任何输出都不会回显它' },
  { name: 'cli-config', type: 'string', placeholder: 'path', summary: 'CLI 配置文件路径' },
  { name: 'no-color', type: 'boolean', summary: '不输出 ANSI 颜色（非 TTY 时本来就不输出）' },
  { name: 'help', type: 'boolean', short: 'h', summary: '显示该命令的帮助' },
];

const OPERATOR_FLAGS: readonly FlagSpec[] = [
  { name: 'config', type: 'string', placeholder: 'install.yaml', summary: '安装配置（Design §11.3）' },
  { name: 'kube-context', type: 'string', placeholder: 'name', summary: 'kubectl 上下文' },
];

const PROJECT_ARG: ArgSpec = { name: 'project', summary: '项目 slug 或项目 ID' };

const OPERATE = '运维（Design §11–12）';
const DEVELOP = '项目与发布';
const SESSION = '开发会话';

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'install', group: OPERATE, summary: '把发行包装进空 Kubernetes 集群（七个阶段）', args: [], emitsDto: true, run: install,
    flags: [...OPERATOR_FLAGS,
      { name: 'bundle', type: 'string', placeholder: 'dir', summary: '发行包目录（Design §11.2）' },
      { name: 'only', type: 'string', placeholder: 'ids', summary: `只跑这些阶段，逗号分隔：${INSTALL_PHASE_IDS.join('、')}` },
      { name: 'dry-run', type: 'boolean', summary: '只做只读预检与计划，不改动集群' }],
  },
  {
    name: 'upgrade', group: OPERATE, summary: '升级平台：扩展迁移在前，按固定顺序滚动副本', args: [], emitsDto: true, run: upgrade,
    flags: [...OPERATOR_FLAGS,
      { name: 'bundle', type: 'string', placeholder: 'dir', summary: '新版本发行包目录' },
      { name: 'only', type: 'string', placeholder: 'ids', summary: `只跑这些步骤，逗号分隔：${UPGRADE_PHASE_IDS.join('、')}` },
      { name: 'dry-run', type: 'boolean', summary: '只做预检，不执行迁移与滚动' }],
  },
  { name: 'status', group: OPERATE, summary: '平台常驻服务副本与本次生效的配置来源', args: [], flags: OPERATOR_FLAGS, emitsDto: true, run: status },
  {
    name: 'verify', group: OPERATE, summary: '运行检查套件', args: [], emitsDto: true, run: verify,
    flags: [...OPERATOR_FLAGS, { name: 'suite', type: 'string', placeholder: 'name', summary: `套件：${SUITE_IDS.join('、')}（默认 smoke）` }],
  },
  { name: 'whoami', group: DEVELOP, summary: '当前身份、平台角色、项目成员关系', args: [], flags: [], emitsDto: true, run: whoami },
  { name: 'projects list', group: DEVELOP, summary: '列出我可见的项目', args: [], flags: [], emitsDto: true, run: listProjects },
  { name: 'projects show', group: DEVELOP, summary: '项目详情', args: [PROJECT_ARG], flags: [], emitsDto: true, run: showProject },
  { name: 'projects branches', group: DEVELOP, summary: '分支列表与落后两槽的提交数', args: [PROJECT_ARG], flags: [], emitsDto: true, run: listBranches },
  {
    name: 'publish', group: DEVELOP, summary: '发布：检查未提交 → 代推 → 打标签 → 构建 → 迁移 → 待命槽', args: [PROJECT_ARG], emitsDto: true, run: publish,
    flags: [
      { name: 'branch', type: 'string', placeholder: 'name', summary: '要发布的分支（必填）' },
      { name: 'version', type: 'string', placeholder: 'v1.2.3|major|minor|patch', summary: '版本号或递增级别，默认 patch' },
      { name: 'message', type: 'string', placeholder: 'text', summary: '发布说明' }],
  },
  { name: 'releases list', group: DEVELOP, summary: '该服务的 Release 列表', args: [PROJECT_ARG], flags: [], emitsDto: true, run: listReleases },
  { name: 'releases show', group: DEVELOP, summary: '单个 Release 详情', args: [{ name: 'releaseId', summary: 'Release ID' }], flags: [], emitsDto: true, run: showRelease },
  { name: 'traffic show', group: DEVELOP, summary: 'preview 与 prod 两槽的当前状态', args: [PROJECT_ARG], flags: [], emitsDto: true, run: showTraffic },
  {
    name: 'traffic switch', group: DEVELOP, summary: '切流或回退（项目负责人）', args: [PROJECT_ARG], emitsDto: true, run: switchTraffic,
    flags: [
      { name: 'to', type: 'string', placeholder: 'preview|prod', summary: 'prod 流量切到哪个槽（必填）' },
      { name: 'expect', type: 'string', placeholder: 'releaseId', summary: '期望的在线 Release，不一致就拒绝' },
      { name: 'reason', type: 'string', placeholder: 'text', summary: '切流原因' }],
  },
  { name: 'traffic history', group: DEVELOP, summary: '历次切流记录', args: [PROJECT_ARG], flags: [], emitsDto: true, run: trafficHistory },
  {
    name: 'session open', group: SESSION, summary: '打开开发会话（一个项目同时只有一个）', args: [PROJECT_ARG], emitsDto: true, run: openSession,
    flags: [{ name: 'branch', type: 'string', placeholder: 'name', summary: '会话工作区检出的分支（必填）' }],
  },
  { name: 'session show', group: SESSION, summary: '当前开发会话', args: [PROJECT_ARG], flags: [], emitsDto: true, run: showSession },
  {
    name: 'session release', group: SESSION, summary: '释放开发会话，并列出未推送的提交', args: [PROJECT_ARG], emitsDto: true, run: releaseSession,
    flags: [{ name: 'force', type: 'boolean', summary: '负责人强制释放他人的会话' }],
  },
  {
    name: 'config list', group: DEVELOP, summary: '配置项与 Secret（Secret 只写不读）', args: [PROJECT_ARG], emitsDto: true, run: listConfig,
    flags: [{ name: 'env', type: 'string', placeholder: 'production|development', summary: '取值组，默认 production' }],
  },
];

export const COMMAND_GROUPS: readonly string[] = [OPERATE, DEVELOP, SESSION];

/** 命令名最多两个词；先试两词再试一词，避免 `projects` 抢走 `projects list`。 */
export function findCommand(tokens: readonly string[]): { readonly command: CommandSpec; readonly rest: readonly string[] } | undefined {
  for (const width of [2, 1]) {
    const name = tokens.slice(0, width).join(' ');
    if (tokens.length < width || tokens.slice(0, width).some((token) => token.startsWith('-'))) continue;
    const command = COMMANDS.find((item) => item.name === name);
    if (command !== undefined) return { command, rest: tokens.slice(width) };
  }
  return undefined;
}

/** 一个命令实际接受的全部标志：自身的、可能的 --json、以及全局的。 */
export function flagsOf(command: CommandSpec): readonly FlagSpec[] {
  return [...command.flags, ...(command.emitsDto ? [JSON_FLAG] : []), ...GLOBAL_FLAGS];
}
