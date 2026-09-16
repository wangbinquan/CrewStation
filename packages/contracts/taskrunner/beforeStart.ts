import { z } from 'zod';

/**
 * RFC-004：Agent 进程启动前 Hook（CrewStation 自身的生命周期，不是 CLI 的同名能力）。
 * 保存、下发与容器内执行三处共用同一组上限；改数字要同时想到已启用版本仍按旧值执行。
 */
export const BEFORE_START_LIMITS = {
  maxSteps: 20,
  /** 单个文件模板或脚本正文。 */
  maxTextBytes: 256 * 1024,
  /** 一份运行环境版本的全部内容。 */
  maxConfigBytes: 1024 * 1024,
  /** 脚本经 CS_HOOK_ENV_OUT 输出的 JSON 字符串映射。 */
  maxEnvOutputBytes: 64 * 1024,
  defaultScriptTimeoutMs: 60_000,
  minScriptTimeoutMs: 1_000,
  maxScriptTimeoutMs: 600_000,
  /** 整条 Hook 的脚本超时之和。 */
  maxTotalTimeoutMs: 1_800_000,
  /** 检查任务保留的脚本输出尾部。 */
  maxLogTailChars: 8 * 1024,
} as const;

export const StepIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'stepId 只允许字母、数字、下划线与连字符，1–64 位');
export const EnvNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/, '变量名必须以字母或下划线开头，只含字母、数字与下划线');
const StepNameSchema = z.string().trim().min(1).max(80);
const PathTemplateSchema = z.string().min(1).max(1024);

export const FileStepFormatSchema = z.enum(['text', 'json', 'jsonc']);
export const FileStepExistingSchema = z.enum(['require-same', 'replace']);

/** 预置一个配置文件：路径与内容都是模板，在目标容器内按当前 Agent 展开。 */
export const FileStepSchema = z.object({
  kind: z.literal('file'),
  stepId: StepIdSchema,
  name: StepNameSchema,
  pathTemplate: PathTemplateSchema,
  contentTemplate: z.string().min(1).max(BEFORE_START_LIMITS.maxTextBytes),
  format: FileStepFormatSchema.default('text'),
  /** 八进制权限位；缺省 0600。 */
  mode: z.number().int().min(0o400).max(0o777).default(0o600),
  /** 已存在且内容不同时：require-same 报 file_path_in_use，replace 原子替换。 */
  existing: FileStepExistingSchema.default('require-same'),
}).strict();

export const ScriptLanguageSchema = z.enum(['shell', 'python', 'javascript', 'custom']);

/** 执行一段初始化脚本：以 Agent 同一身份运行，环境变量经 CS_HOOK_ENV_OUT 约定输出。 */
export const ScriptStepSchema = z.object({
  kind: z.literal('script'),
  stepId: StepIdSchema,
  name: StepNameSchema,
  language: ScriptLanguageSchema,
  source: z.string().min(1).max(BEFORE_START_LIMITS.maxTextBytes),
  /** custom：可执行文件与固定参数，不拼成 shell 字符串；预设语言忽略。 */
  interpreter: z.array(z.string().min(1).max(1024)).min(1).max(16).optional(),
  argv: z.array(z.string().max(4096)).max(32).default([]),
  cwdTemplate: PathTemplateSchema.optional(),
  timeoutMs: z.number().int().min(BEFORE_START_LIMITS.minScriptTimeoutMs).max(BEFORE_START_LIMITS.maxScriptTimeoutMs).default(BEFORE_START_LIMITS.defaultScriptTimeoutMs),
}).strict().refine((step) => step.language !== 'custom' || (step.interpreter?.length ?? 0) > 0, { message: '自定义解释器必须给出可执行文件与参数', path: ['interpreter'] });

export const BeforeStartStepSchema = z.discriminatedUnion('kind', [FileStepSchema, ScriptStepSchema]);

/** 有序步骤表：列表顺序即执行顺序；stepId 唯一，脚本超时之和受上限约束。 */
export const BeforeStartStepsSchema = z.array(BeforeStartStepSchema).max(BEFORE_START_LIMITS.maxSteps).superRefine((steps, ctx) => {
  const ids = steps.map((s) => s.stepId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'stepId 不能重复' });
  const total = steps.reduce((sum, s) => sum + (s.kind === 'script' ? s.timeoutMs : 0), 0);
  if (total > BEFORE_START_LIMITS.maxTotalTimeoutMs) ctx.addIssue({ code: 'custom', message: `脚本超时之和 ${total}ms 超过 ${BEFORE_START_LIMITS.maxTotalTimeoutMs}ms` });
});

export const RuntimeDriverSchema = z.enum(['claude-code', 'opencode']);

/** 哪个文件供 CLI 加载：Claude 的 settings.json 或 OpenCode 的配置文件；none 表示只用平台合成。 */
export const ConfigFileBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('claude-settings'), pathTemplate: PathTemplateSchema }).strict(),
  z.object({ kind: z.literal('opencode-config'), pathTemplate: PathTemplateSchema }).strict(),
]);

export const RuntimeRevisionRefSchema = z.object({ configId: z.string().min(1), revision: z.number().int().min(1) });

/**
 * 下发给 TaskRunner 的一次启动材料。密钥值只在这里出现一次：不进事件、不进名册、不进日志。
 * 材料对应一个固定版本，同一 agentId／attempt 的重试必须重用同一份材料而不是重新解析“最新”。
 */
export const AgentRuntimeMaterialSchema = z.object({
  configId: z.string().min(1),
  configName: z.string().min(1),
  revision: z.number().int().min(1),
  driver: RuntimeDriverSchema,
  contentHash: z.string().min(1),
  steps: BeforeStartStepsSchema,
  vars: z.record(EnvNameSchema, z.string()).default({}),
  secrets: z.record(EnvNameSchema, z.string()).default({}),
  configFile: ConfigFileBindingSchema,
  /** 管理员检查任务保留脚本输出尾部；租户启动不收集。 */
  captureOutput: z.boolean().default(false),
}).strict();

export const BeforeStartStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const BeforeStartStepStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']);
export const BeforeStartErrorCodeSchema = z.enum([
  'template_variable_undefined', 'invalid_json', 'path_denied', 'file_path_in_use', 'file_write_failed',
  'unknown_interpreter', 'script_failed', 'script_timeout', 'env_output_invalid', 'reserved_variable',
  'cli_config_invalid', 'cancelled', 'internal_error',
]);
export const BeforeStartErrorSchema = z.object({ code: BeforeStartErrorCodeSchema, message: z.string(), stepId: StepIdSchema.optional() });

export const BeforeStartStepRecordSchema = z.object({
  stepId: StepIdSchema,
  name: StepNameSchema,
  kind: z.enum(['file', 'script']),
  state: BeforeStartStepStateSchema,
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** 展开后的实际落点（文件）或工作目录（脚本）；不含内容。 */
  path: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  /** 脚本经输出协议提供的变量名；值不出现。 */
  outputVariables: z.array(EnvNameSchema).optional(),
  error: BeforeStartErrorSchema.optional(),
  /** 只有 captureOutput 的检查任务携带。 */
  log: z.object({ stdoutTail: z.string().max(BEFORE_START_LIMITS.maxLogTailChars), stderrTail: z.string().max(BEFORE_START_LIMITS.maxLogTailChars) }).optional(),
});

/** 一次启动前执行的可观察记录；租户看到步骤名与进度，脚本源码、文件正文与输出不经此广播。 */
export const BeforeStartExecutionSchema = z.object({
  executionId: z.string().min(1),
  agentId: z.string().min(1),
  processAttemptId: z.string().min(1),
  runtime: RuntimeRevisionRefSchema,
  state: BeforeStartStateSchema,
  queuedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  currentStepId: StepIdSchema.optional(),
  steps: z.array(BeforeStartStepRecordSchema),
  error: BeforeStartErrorSchema.optional(),
});

/** hello 里宣告的可用解释器；custom 由管理员给绝对路径，不在清单里。 */
export const RunnerInterpreterSchema = z.object({ language: z.enum(['shell', 'python', 'javascript']), command: z.string().min(1), version: z.string().nullable() });

/** 脚本可读的只读上下文变量名；环境输出不得覆盖它们。 */
export const HOOK_CONTEXT_ENV = {
  agentId: 'CS_AGENT_ID',
  agentHome: 'CS_AGENT_HOME',
  agentRunDir: 'CS_AGENT_RUN_DIR',
  workdir: 'CS_WORKDIR',
  envOut: 'CS_HOOK_ENV_OUT',
} as const;

export type BeforeStartStep = z.infer<typeof BeforeStartStepSchema>;
export type FileStep = z.infer<typeof FileStepSchema>;
export type ScriptStep = z.infer<typeof ScriptStepSchema>;
export type ScriptLanguage = z.infer<typeof ScriptLanguageSchema>;
export type RuntimeDriver = z.infer<typeof RuntimeDriverSchema>;
export type ConfigFileBinding = z.infer<typeof ConfigFileBindingSchema>;
export type RuntimeRevisionRef = z.infer<typeof RuntimeRevisionRefSchema>;
export type AgentRuntimeMaterial = z.infer<typeof AgentRuntimeMaterialSchema>;
export type BeforeStartState = z.infer<typeof BeforeStartStateSchema>;
export type BeforeStartStepState = z.infer<typeof BeforeStartStepStateSchema>;
export type BeforeStartErrorCode = z.infer<typeof BeforeStartErrorCodeSchema>;
export type BeforeStartError = z.infer<typeof BeforeStartErrorSchema>;
export type BeforeStartStepRecord = z.infer<typeof BeforeStartStepRecordSchema>;
export type BeforeStartExecution = z.infer<typeof BeforeStartExecutionSchema>;
export type RunnerInterpreter = z.infer<typeof RunnerInterpreterSchema>;
