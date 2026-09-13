import { z } from 'zod';
import { SubtaskIdSchema, TaskIdSchema } from '../ids';
import { AgentDriverSchema, AgentPermissionSchema, OutputContractSchema } from '../manifest/tasks';
import { AgentEventSchema } from './agentEvents';
import { NativeActivityEventSchema } from './nativeActivity';
import { RunnerWorkspaceStatusSchema } from './workspace';
import { ComparisonDetailQuerySchema, ComparisonDetailsSchema, GitObjectIdSchema, RunnerComparisonSchema } from './workspaceComparison';
import { NativeTerminalRecordSchema, NativeTerminalRosterSchema, TerminalControlSchema, TerminalSizeSchema, TerminalSnapshotSchema } from './nativeTerminal';

/** TaskRunner ↔ cs-session 协议版本；不兼容变更递增，双方在 hello 时校验。 */
export const TASKRUNNER_PROTOCOL_VERSION = 1;

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
    drivers: z.array(AgentDriverSchema),
    pty: z.boolean(),
    preview: z.boolean(),
  }),
});

const cmd = <T extends string>(type: T) => ({ id: z.string().min(1), type: z.literal(type) });

export const StartAgentCommandSchema = z.object({
  ...cmd('startAgent'),
  agentId: z.string().min(1),
  /**
   * 算力档位名（RFC-001）。平台原样透传，TaskRunner 不解释，只在 started 事件里回显。
   * 两个档位可以指向同一个模型，从 (driver, model) 反查不出唯一档位名，因此必须透传。
   */
  compute: z.string().min(1),
  driver: AgentDriverSchema,
  model: z.string().min(1),
  permission: AgentPermissionSchema,
  mode: z.enum(['oneshot', 'interactive']),
  cwd: z.string().optional(),
  initialPrompt: z.string().optional(),
  resumeSessionId: z.string().optional(),
  systemPrompt: z.string().optional(),
  mcp: z.array(McpConnectionSchema).default([]),
  /** 追加到 Agent 进程的环境变量名值对；模型凭据也经此进入（接受的残余风险）。 */
  env: z.record(z.string(), z.string()).default({}),
});

export const StartAgentTerminalCommandSchema = StartAgentCommandSchema.omit({ mode: true, initialPrompt: true, resumeSessionId: true }).extend({
  type: z.literal('startAgentTerminal'), driver: z.enum(['claude-code', 'opencode']),
  terminalId: z.string().min(1), runnerId: z.uuid(), requestFingerprint: z.string().min(1),
  ...TerminalSizeSchema.shape,
});

export const RunnerCommandSchema = z.discriminatedUnion('type', [
  StartAgentCommandSchema,
  StartAgentTerminalCommandSchema,
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
  z.object({ ...cmd('verifyContract'), subtaskId: SubtaskIdSchema, contract: OutputContractSchema, cwd: z.string().optional() }),
  z.object({ ...cmd('shutdown'), graceSeconds: z.number().int().min(0).max(300).default(30) }),
]);

export const FileEntrySchema = z.object({ name: z.string(), kind: z.enum(['file', 'dir', 'symlink', 'other']), size: z.number().int().min(0), modifiedAt: z.iso.datetime() });
export const PreviewStateSchema = z.enum(['disabled', 'stopped', 'starting', 'ready', 'crashed']);

export const RunnerResultPayloads = {
  startAgentTerminal: NativeTerminalRecordSchema,
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
  verifyContract: z.object({ ok: z.boolean(), missing: z.array(z.string()), schemaErrors: z.array(z.string()) }),
  /** exec 且 wait=true 的结果；stdout/stderr 各最多 256 KiB，超出即 truncated。 */
  exec: z.object({ execId: z.string(), exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string(), durationMs: z.number().int().min(0), truncated: z.boolean() }),
  ack: z.object({}),
} as const;

export const RunnerEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nativeActivity'), activity: NativeActivityEventSchema }),
  z.object({ kind: z.literal('nativeTerminal'), terminal: NativeTerminalRecordSchema }),
  z.object({ kind: z.literal('agent'), event: AgentEventSchema }),
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
export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
export type RunnerMessage = z.infer<typeof RunnerMessageSchema>;
export type SessionMessage = z.infer<typeof SessionMessageSchema>;
export type PreviewState = z.infer<typeof PreviewStateSchema>;
export type FileEntry = z.infer<typeof FileEntrySchema>;
