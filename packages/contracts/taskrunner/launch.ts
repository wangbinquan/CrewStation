import { z } from 'zod';
import { EnvNameSchema } from './beforeStart';

/**
 * RFC-006：档位的协议。claude-code／opencode 由平台解析事件与会话，可用于「＋ CLI」、headless Agent 与业务子任务；
 * terminal 是通用终端协议：任意 CLI 只在「＋ CLI」的终端里运行，平台不解析它的输出（C6）。
 */
export const AgentProtocolSchema = z.enum(['claude-code', 'opencode', 'terminal']);
export const KnownAgentProtocolSchema = z.enum(['claude-code', 'opencode']);

/** 配置目录叶子名：fork 改了目录名时填写；必须是单层目录名。 */
export const ConfigDirNameSchema = z.string().min(1).max(64).refine((name) => !/[/\\\0]/.test(name) && name !== '.' && name !== '..', '配置目录名必须是单层目录名，不能含路径分隔符，也不能是 . 或 ..');

/** opencode 协议专用的生成参数（与 agent-workflow 的运行时字段一致）。 */
export const OpencodeParamsSchema = z.object({
  variant: z.string().min(1).max(100).optional(),
  temperature: z.number().min(0).max(2).optional(),
  steps: z.number().int().min(1).max(10000).optional(),
  maxSteps: z.number().int().min(1).max(10000).optional(),
}).strict();

export const LaunchArgSchema = z.string().min(1).max(512);

/**
 * 一次启动用的二进制与参数：档位修订里固定，随 startAgent／startAgentTerminal 下发给 Runner。
 * 字段按协议生效（proposal.md §5.1）：附加参数只给 claude-code 与 terminal；IS_SANDBOX 只给 claude-code；
 * 配置目录覆盖只给两种已知协议；opencode 参数只给 opencode；terminal 不带模型。
 */
export const LaunchSpecSchema = z.object({
  protocol: AgentProtocolSchema,
  /** 容器内绝对路径，必填（C5）：平台不再按协议默认名启动。 */
  binaryPath: z.string().startsWith('/', '二进制路径必须是容器内绝对路径').max(1024),
  extraArgs: z.array(LaunchArgSchema).max(16).default([]),
  configDirEnv: EnvNameSchema.optional(),
  configDirName: ConfigDirNameSchema.optional(),
  isSandbox: z.boolean().default(false),
  /** 传给 CLI 的模型；留空则不传，由二进制用自己的默认值（P2）。 */
  model: z.string().min(1).max(200).optional(),
  opencode: OpencodeParamsSchema.optional(),
}).strict().superRefine((spec, ctx) => {
  for (const issue of launchApplicabilityIssues(spec)) ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.field] });
});

export interface LaunchIssue { readonly field: string; readonly message: string }

/** 按协议逐字段判定：不适用的字段一律拒绝，而不是静默忽略（管理员会以为自己配置生效了）。 */
export function launchApplicabilityIssues(spec: Pick<LaunchSpec, 'protocol' | 'extraArgs' | 'configDirEnv' | 'configDirName' | 'isSandbox' | 'model' | 'opencode'>): LaunchIssue[] {
  const issues: LaunchIssue[] = [];
  const reject = (field: string, allowed: string) => issues.push({ field, message: `${field} 只对 ${allowed} 协议生效` });
  if (spec.protocol === 'opencode' && (spec.extraArgs?.length ?? 0) > 0) reject('extraArgs', 'claude-code 与 terminal');
  if (spec.protocol !== 'claude-code' && spec.isSandbox) reject('isSandbox', 'claude-code');
  if (spec.protocol === 'terminal' && spec.configDirEnv !== undefined) reject('configDirEnv', 'claude-code 与 opencode');
  if (spec.protocol === 'terminal' && spec.configDirName !== undefined) reject('configDirName', 'claude-code 与 opencode');
  if (spec.protocol === 'terminal' && spec.model !== undefined) reject('model', 'claude-code 与 opencode');
  if (spec.protocol !== 'opencode' && spec.opencode !== undefined) reject('opencode', 'opencode');
  return issues;
}

/** 通用终端 CLI 从进程环境读取平台 MCP 的约定变量名（C16）；两种已知协议由平台直接注入配置。 */
export const TERMINAL_MCP_ENV = {
  capabilitiesUrl: 'CS_MCP_CAPABILITIES_URL',
  operationsUrl: 'CS_MCP_OPERATIONS_URL',
  token: 'CS_MCP_TOKEN',
} as const;

export const isKnownProtocol = (protocol: AgentProtocol): protocol is KnownAgentProtocol => protocol !== 'terminal';

/**
 * claude-code 协议里平台自己装配的参数（与 agent-workflow 的平台独占 flag 表一致）：附加参数不能覆盖它们，
 * `--flag=value` 形式同样拒绝。保存时（agent-runtime）与启动时（agent-drivers）用同一份表。
 */
export const CLAUDE_RESERVED_ARGS: readonly string[] = Object.freeze([
  '-p', '--print', '--output-format', '--input-format', '--verbose', '--model',
  '--append-system-prompt-file', '--append-system-prompt', '--system-prompt', '--system-prompt-file',
  '--mcp-config', '--agents', '--resume', '--continue', '--session-id', '--fork-session',
  '--permission-mode', '--dangerously-skip-permissions', '--tools', '--allowedTools', '--allowed-tools',
  '--disallowedTools', '--disallowed-tools', '--settings', '--add-dir',
]);

/** 附加参数命中平台保留参数时返回那个参数名；通用终端协议平台不装配任何参数，恒为 undefined。 */
export function reservedLaunchArg(protocol: AgentProtocol, arg: string): string | undefined {
  if (protocol !== 'claude-code') return undefined;
  const flag = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
  return CLAUDE_RESERVED_ARGS.includes(flag) ? flag : undefined;
}

/**
 * 平台写进每次 Agent 启动的环境变量：配置目录变量名与之相同会让两套机制互相覆盖（agent-workflow RFC-154 的教训），
 * 保存时拒绝。CS_ 前缀整体保留给平台。各协议自己的默认配置目录变量名不在其中，重复声明无害。
 */
export const PLATFORM_SPAWN_ENV: readonly string[] = Object.freeze([
  'PWD', 'HOME', 'USER', 'LOGNAME', 'PATH', 'IS_SANDBOX', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_PERMISSION',
  'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL',
]);
export const isPlatformSpawnEnv = (name: string): boolean => PLATFORM_SPAWN_ENV.includes(name) || name.startsWith('CS_');

export type AgentProtocol = z.infer<typeof AgentProtocolSchema>;
export type KnownAgentProtocol = z.infer<typeof KnownAgentProtocolSchema>;
export type OpencodeParams = z.infer<typeof OpencodeParamsSchema>;
export type LaunchSpec = z.infer<typeof LaunchSpecSchema>;
