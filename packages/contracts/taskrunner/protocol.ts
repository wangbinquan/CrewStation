import { z } from 'zod';
import { SubtaskIdSchema, TaskIdSchema } from '../ids';
import { AgentPermissionSchema, OutputContractSchema } from '../manifest/tasks';
import { AgentEventSchema } from './agentEvents';
import { NativeActivityEventSchema } from './nativeActivity';
import { RunnerApiInvocationSchema, ApiInvocationResultSchema } from './apiInvocation';
import { RunnerWorkspaceStatusSchema } from './workspace';
import { ComparisonDetailQuerySchema, ComparisonDetailsSchema, GitObjectIdSchema, RunnerComparisonSchema } from './workspaceComparison';
import { NativeTerminalRecordSchema, NativeTerminalRosterSchema, TerminalControlSchema, TerminalSizeSchema, TerminalSnapshotSchema } from './nativeTerminal';
import { BeforeStartErrorSchema, BeforeStartExecutionSchema, BeforeStartMaterialSchema, RunnerInterpreterSchema } from './beforeStart';
import { AgentProtocolSchema, LaunchSpecSchema } from './launch';

/**
 * TaskRunner ↔ cs-session 协议版本；不兼容变更递增，双方在 hello 时校验。
 * 3（RFC-013）：平台资源引用使用 UUIDv7；协议 2 经服务端显式兼容入口投影。
 * 2（RFC-006）：启动命令携带档位修订的 launch 与必有的启动前材料，hello 报 Runner 理解的协议；旧底座镜像里的 Runner 握手即被拒。
 */
export const TASKRUNNER_PROTOCOL_VERSION = 3;

export const McpConnectionSchema = z.object({
  name: z.string().min(1),
  /** Streamable HTTP 地址（平台两个 MCP 的服务域地址）。 */
  url: z.url(),
  headers: z.record(z.string(), z.string()).default({}),
});

export const RunnerHelloSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(TASKRUNNER_PROTOCOL_VERSION),
  taskId: TaskIdSchema,
  /** 平台在容器启动时注入的一次性令牌，cs-session 校验归属。 */
  runnerToken: z.string().min(1),
  workdir: z.string().min(1),
  capabilities: z.object({
    /** Runner 代码理解的协议；二进制在不在、能不能起由档位测试证明，不由 hello 声称（RFC-006）。 */
    protocols: z.array(AgentProtocolSchema),
    pty: z.boolean(),
    preview: z.boolean(),
    apiInvocations: z.literal(1).optional(),
    /**
     * RFC-016：懂 startPreview／stopPreview／previewLogs。用能力位而不是升协议版本——
     * 开发会话是长活对象，升版会让集群里正跑的旧镜像容器握手即被拒，等于强制所有人释放会话。
     */
    previewControl: z.literal(1).optional(),
    /** 容器内实际可用的脚本解释器清单；缺少所需语言的启动在执行前被拒。 */
    interpreters: z.array(RunnerInterpreterSchema).optional(),
  }),
});

const cmd = <T extends string>(type: T) => ({ id: z.string().min(1), type: z.literal(type) });

/** 两类启动命令共用的档位部分：名称回显、固定修订、二进制与参数、启动前材料与尝试标识（RFC-006）。 */
const ProfileLaunchShape = {
  /** 算力档位名：平台原样透传，TaskRunner 不解释，只在 started 事件与名册里回显。 */
  compute: z.string().min(1),
  profileRevision: z.number().int().min(1),
  launch: LaunchSpecSchema,
  permission: AgentPermissionSchema,
  cwd: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcp: z.array(McpConnectionSchema).default([]),
  /** 追加到 Agent 进程的环境变量名值对。 */
  env: z.record(z.string(), z.string()).default({}),
  /** 档位修订的启动前材料：每次启动都有（可以没有步骤），Hook 成功后才创建 CLI 进程。 */
  beforeStart: BeforeStartMaterialSchema,
  /** 同一 Agent 每次真实创建 CLI 进程的尝试标识；重发同一 attempt 只恢复原执行结果，不重跑脚本。 */
  processAttemptId: z.string().min(1),
};

export const StartAgentCommandSchema = z.object({
  ...cmd('startAgent'),
  agentId: z.string().min(1),
  ...ProfileLaunchShape,
  mode: z.enum(['oneshot', 'interactive']),
  initialPrompt: z.string().optional(),
  resumeSessionId: z.string().optional(),
}).superRefine((command, ctx) => {
  // headless 与业务子任务要解析事件与会话：通用终端协议只能进「＋ CLI」（RFC-006 C6）。
  if (command.launch.protocol === 'terminal') ctx.addIssue({ code: 'custom', message: '通用终端协议的档位只能用于「＋ CLI」', path: ['launch', 'protocol'] });
});

export const StartAgentTerminalCommandSchema = z.object({
  ...cmd('startAgentTerminal'),
  agentId: z.string().min(1),
  ...ProfileLaunchShape,
  terminalId: z.string().min(1), runnerId: z.uuid(), requestFingerprint: z.string().min(1),
  ...TerminalSizeSchema.shape,
});

/** 通用终端协议的档位测试（RFC-006 C11）：先跑启动前步骤，再执行管理员的测试命令并按正则判定输出。 */
export const ProbeTerminalCommandSchema = z.object({
  ...cmd('probeTerminal'),
  probeId: z.string().min(1),
  compute: z.string().min(1),
  profileRevision: z.number().int().min(1),
  launch: LaunchSpecSchema,
  command: z.array(z.string().min(1)).min(1).max(32),
  /** 期望输出的正则源码；对 stdout＋stderr 判定。 */
  expect: z.string().min(1).max(1024),
  timeoutMs: z.number().int().min(1000).max(600_000),
  cwd: z.string().optional(),
  mcp: z.array(McpConnectionSchema).default([]),
  env: z.record(z.string(), z.string()).default({}),
  beforeStart: BeforeStartMaterialSchema,
  processAttemptId: z.string().min(1),
});

/** probeTerminal 的结果：启动前步骤失败时没有 command 段；输出只保留有界尾部。 */
export const ProbeTerminalResultSchema = z.object({
  probeId: z.string(),
  beforeStart: z.object({ state: z.enum(['succeeded', 'failed', 'cancelled']), error: BeforeStartErrorSchema.optional() }),
  command: z.object({
    exitCode: z.number().int().nullable(),
    timedOut: z.boolean(),
    matched: z.boolean(),
    outputTail: z.string().max(8192),
    durationMs: z.number().int().min(0),
    spawnError: z.string().optional(),
  }).optional(),
});

/**
 * RFC-016 预览输出缓冲的界（Runner 侧内存，不持久化）。
 * `maxBytes` 与 exec 结果的上限取齐，不引入第二套尺度；行数与字节数任一触顶都从头丢弃。
 */
export const PREVIEW_LOG_LIMITS = { maxLines: 2000, maxBytes: 256 * 1024, maxLineBytes: 8 * 1024, defaultLimit: 200 } as const;

export const RunnerCommandSchema = z.discriminatedUnion('type', [
  StartAgentCommandSchema,
  StartAgentTerminalCommandSchema,
  ProbeTerminalCommandSchema,
  RunnerApiInvocationSchema.safeExtend({ ...cmd('invokeApi') }),
  z.object({ ...cmd('listAgentTerminals') }),
  z.object({ ...cmd('stopAgentTerminal'), agentId: z.string().min(1), runnerId: z.uuid() }),
  z.object({ ...cmd('attachTerminal'), terminalId: z.string().min(1), runnerId: z.uuid() }),
  z.object({ ...cmd('claimTerminalControl'), terminalId: z.string().min(1), viewId: z.string().min(1), runnerId: z.uuid() }),
  z.object({ ...cmd('detachTerminal'), terminalId: z.string().min(1), viewId: z.string().min(1) }),
  z.object({ ...cmd('sendMessage'), agentId: z.string().min(1), content: z.string() }),
  z.object({ ...cmd('cancelAgent'), agentId: z.string().min(1) }),
  /** wait=false：立即回 ack，输出以 execOutput/execExited 事件流出；wait=true：结束后一次性回 RunnerResultPayloads.exec（输出有上限）。 */
  z.object({ ...cmd('exec'), execId: z.string().min(1), command: z.array(z.string()).min(1), cwd: z.string().optional(), env: z.record(z.string(), z.string()).default({}), timeoutSeconds: z.number().int().min(1).max(86400).default(3600), wait: z.boolean().default(false) }),
  z.object({ ...cmd('cancelExec'), execId: z.string().min(1) }),
  z.object({ ...cmd('openTerminal'), terminalId: z.string().min(1), cols: z.number().int().min(1), rows: z.number().int().min(1), cwd: z.string().optional() }),
  z.object({ ...cmd('terminalInput'), terminalId: z.string().min(1), data: z.string().max(65536), viewId: z.string().optional() }),
  z.object({ ...cmd('terminalResize'), terminalId: z.string().min(1), cols: z.number().int().min(1), rows: z.number().int().min(1), viewId: z.string().optional() }),
  z.object({ ...cmd('closeTerminal'), terminalId: z.string().min(1) }),
  z.object({ ...cmd('listFiles'), path: z.string().default('.') }),
  z.object({ ...cmd('readFile'), path: z.string().min(1) }),
  z.object({ ...cmd('writeFile'), path: z.string().min(1), content: z.string(), expectedVersion: z.string().optional() }),
  z.object({ ...cmd('workspaceStatus') }),
  z.object({ ...cmd('compareWorkspace'), targetSha: GitObjectIdSchema.optional() }),
  ComparisonDetailQuerySchema.extend({ ...cmd('workspaceComparisonDetails'), comparisonId: z.string().min(1) }),
  z.object({ ...cmd('fetchComparisonHistory'), url: z.string().min(1), targetSha: GitObjectIdSchema.optional() }),
  z.object({ ...cmd('previewStatus') }),
  z.object({ ...cmd('restartPreview') }),
  z.object({ ...cmd('startPreview') }),
  z.object({ ...cmd('stopPreview') }),
  z.object({ ...cmd('previewLogs'), limit: z.number().int().min(1).max(PREVIEW_LOG_LIMITS.maxLines).default(PREVIEW_LOG_LIMITS.defaultLimit), stream: z.enum(['stdout', 'stderr']).optional() }),
  z.object({ ...cmd('verifyContract'), subtaskId: SubtaskIdSchema, contract: OutputContractSchema, cwd: z.string().optional() }),
  z.object({ ...cmd('shutdown'), graceSeconds: z.number().int().min(0).max(300).default(30) }),
]);

export const FileEntrySchema = z.object({ name: z.string(), kind: z.enum(['file', 'dir', 'symlink', 'other']), size: z.number().int().min(0), modifiedAt: z.iso.datetime() });
export const PreviewStateSchema = z.enum(['disabled', 'stopped', 'starting', 'ready', 'crashed']);

/** 一行预览进程输出；`attempt` 是写入时的第几次运行，跨重启保留，用来区分崩溃前后的输出。 */
export const PreviewLogLineSchema = z.object({
  at: z.iso.datetime(),
  stream: z.enum(['stdout', 'stderr']),
  attempt: z.number().int().min(1),
  text: z.string(),
  /** 单行超过 maxLineBytes 被截断。 */
  truncated: z.boolean().optional(),
});

export const RunnerResultPayloads = {
  invokeApi: ApiInvocationResultSchema,
  startAgentTerminal: NativeTerminalRecordSchema,
  probeTerminal: ProbeTerminalResultSchema,
  listAgentTerminals: NativeTerminalRosterSchema,
  attachTerminal: TerminalSnapshotSchema,
  claimTerminalControl: TerminalControlSchema,
  workspaceStatus: RunnerWorkspaceStatusSchema,
  compareWorkspace: RunnerComparisonSchema,
  workspaceComparisonDetails: ComparisonDetailsSchema,
  listFiles: z.object({ path: z.string(), entries: z.array(FileEntrySchema) }),
  /** version 为内容 sha256，写入时用 expectedVersion 做乐观并发。 */
  readFile: z.object({ path: z.string(), content: z.string(), version: z.string(), size: z.number().int().min(0) }),
  writeFile: z.object({ path: z.string(), version: z.string() }),
  previewStatus: z.object({ state: PreviewStateSchema, port: z.number().int().optional(), restarts: z.number().int().min(0), lastError: z.string().optional() }),
  /** `dropped` 是自会话开始被挤掉的行数；`attempt` 是当前运行序号，与行上的 attempt 同源。 */
  previewLogs: z.object({ lines: z.array(PreviewLogLineSchema), dropped: z.number().int().min(0), attempt: z.number().int().min(1) }),
  verifyContract: z.object({ ok: z.boolean(), missing: z.array(z.string()), schemaErrors: z.array(z.string()) }),
  /** exec 且 wait=true 的结果；stdout/stderr 各最多 256 KiB，超出即 truncated。 */
  exec: z.object({ execId: z.string(), exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string(), durationMs: z.number().int().min(0), truncated: z.boolean() }),
  ack: z.object({}),
} as const;

export const RunnerEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nativeActivity'), activity: NativeActivityEventSchema }),
  z.object({ kind: z.literal('nativeTerminal'), terminal: NativeTerminalRecordSchema }),
  z.object({ kind: z.literal('agent'), event: AgentEventSchema }),
  z.object({ kind: z.literal('beforeStart'), execution: BeforeStartExecutionSchema }),
  z.object({ kind: z.literal('terminalOutput'), terminalId: z.string(), data: z.string(), terminalSeq: z.number().int().nonnegative().optional(), runnerId: z.uuid().optional() }),
  z.object({ kind: z.literal('terminalResized'), terminalId: z.string(), runnerId: z.uuid(), terminalSeq: z.number().int().nonnegative(), ...TerminalSizeSchema.shape }),
  z.object({ kind: z.literal('terminalClosed'), terminalId: z.string(), exitCode: z.number().int().nullable() }),
  z.object({ kind: z.literal('execOutput'), execId: z.string(), stream: z.enum(['stdout', 'stderr']), data: z.string() }),
  z.object({ kind: z.literal('execExited'), execId: z.string(), exitCode: z.number().int().nullable(), durationMs: z.number().int().min(0) }),
  z.object({ kind: z.literal('previewState'), state: PreviewStateSchema, port: z.number().int().optional(), message: z.string().optional() }),
  z.object({ kind: z.literal('fileChanged'), path: z.string() }),
  z.object({ kind: z.literal('runnerState'), state: z.enum(['ready', 'draining', 'shutting-down']) }),
]);

export const RunnerMessageSchema = z.discriminatedUnion('type', [
  RunnerHelloSchema,
  z.object({ type: z.literal('result'), id: z.string().min(1), payload: z.unknown() }),
  z.object({ type: z.literal('error'), id: z.string().min(1), code: z.string().min(1), message: z.string() }),
  z.object({ type: z.literal('event'), seq: z.number().int().min(0), at: z.iso.datetime(), event: RunnerEventSchema }),
  z.object({ type: z.literal('pong'), at: z.iso.datetime() }),
]);

/** cs-session → TaskRunner 的下行帧：命令或心跳。 */
export const SessionMessageSchema = z.union([
  RunnerCommandSchema,
  z.object({ type: z.literal('ping'), at: z.iso.datetime() }),
  z.object({ type: z.literal('welcome'), protocolVersion: z.literal(TASKRUNNER_PROTOCOL_VERSION), resumeFromSeq: z.number().int().min(0), nativeActivityVersion: z.literal(1).optional() }),
]);

export type McpConnection = z.infer<typeof McpConnectionSchema>;
export type RunnerHello = z.infer<typeof RunnerHelloSchema>;
export type RunnerCommand = z.infer<typeof RunnerCommandSchema>;
export type StartAgentCommand = z.infer<typeof StartAgentCommandSchema>;
export type StartAgentTerminalCommand = z.infer<typeof StartAgentTerminalCommandSchema>;
export type ProbeTerminalCommand = z.infer<typeof ProbeTerminalCommandSchema>;
export type ProbeTerminalResult = z.infer<typeof ProbeTerminalResultSchema>;
export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
export type RunnerMessage = z.infer<typeof RunnerMessageSchema>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type PreviewState = z.infer<typeof PreviewStateSchema>;
export type PreviewLogLine = z.infer<typeof PreviewLogLineSchema>;
export type PreviewStatusPayload = z.infer<(typeof RunnerResultPayloads)['previewStatus']>;
export type PreviewLogsPayload = z.infer<(typeof RunnerResultPayloads)['previewLogs']>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
