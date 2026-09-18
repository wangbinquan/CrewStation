import { z } from 'zod';
import { ProfileTestIdSchema, SlugSchema, TaskIdSchema, UserIdSchema } from '../../ids';
import { BeforeStartErrorSchema, BeforeStartStepsSchema, ConfigFileBindingSchema, EnvNameSchema, RunnerInterpreterSchema, StepIdSchema } from '../../taskrunner/beforeStart';
import { AgentProtocolSchema, LaunchSpecSchema } from '../../taskrunner/launch';

/**
 * 算力档位（RFC-006）：一个对象就是一份完整执行配置——协议、镜像、二进制与参数、启动前步骤、变量与凭据、模型、资源套餐。
 * 只有管理员维护；业务与租户只按名称（或 `default`）引用，看不到镜像、二进制、模型与步骤。
 */

/** Manifest 与 API 里指代「管理员设为默认的档位」的保留名；每次启动 Agent 时解析（C13、C17）。 */
export const DEFAULT_COMPUTE_PROFILE = 'default';
export const ComputeProfileNameSchema = SlugSchema.refine((name) => name !== DEFAULT_COMPUTE_PROFILE, '`default` 是保留名，指代平台默认档位');

/** 档位用途：通用终端协议只能用于「＋ CLI」。 */
export const ComputeUsageSchema = z.enum(['cli', 'agent', 'subtask']);

/**
 * 说明文字：建档时缺省为空串；保存与复制时缺省表示「不改／沿用原档位」，这两处用不带 default 的版本——
 * zod 4 的 default 包在 optional 里照样生效，会把缺省变成空串，把原说明清掉（2026-09-18 实机发现）。
 */
const DescriptionTextSchema = z.string().max(500);
export const ComputeProfileDescriptionSchema = DescriptionTextSchema.default('');

/** 通用终端协议的测试命令（C11）：argv 数组，不拼成 shell 字符串；期望输出是对 stdout＋stderr 的正则。 */
export const TerminalTestSchema = z.object({
  command: z.array(z.string().min(1).max(4096)).min(1).max(32),
  expect: z.string().min(1).max(1024),
  timeoutMs: z.number().int().min(1000).max(600_000).default(60_000),
}).strict();

/**
 * 一个档位修订的内容（不含凭据值）。image 是管理员填写的平台仓库引用（C15），保存时解析出摘要并随修订固定；
 * launch.protocol 必须等于档位的协议（建档后不可改，P1）。
 */
export const ComputeProfileContentSchema = z.object({
  image: z.string().min(1).max(512),
  launch: LaunchSpecSchema,
  /** 该档位每个 Agent Pod 的资源套餐；省略时用平台默认任务套餐。 */
  taskProfile: SlugSchema.optional(),
  steps: BeforeStartStepsSchema.default([]),
  vars: z.record(EnvNameSchema, z.string().max(65536)).default({}),
  /** 修订声明的凭据名；模板只能引用这里列出的名字，值经 credentials 单独写入。 */
  secretNames: z.array(EnvNameSchema).max(64).default([]),
  configFile: ConfigFileBindingSchema.default({ kind: 'none' }),
  terminalTest: TerminalTestSchema.optional(),
}).strict();

/** 凭据写操作三选一；GET 从不返回原值或可重用密文。 */
export const ProfileCredentialWriteSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('keep') }).strict(),
  z.object({ op: z.literal('replace'), value: z.string().min(1).max(65536) }).strict(),
  z.object({ op: z.literal('clear') }).strict(),
]);
export const ProfileCredentialStateSchema = z.object({ name: EnvNameSchema, set: z.boolean(), updatedBy: UserIdSchema.optional(), updatedAt: z.iso.datetime().optional() });

export const CreateComputeProfileRequestSchema = z.object({
  name: ComputeProfileNameSchema,
  description: ComputeProfileDescriptionSchema,
  content: ComputeProfileContentSchema,
  credentials: z.record(EnvNameSchema, ProfileCredentialWriteSchema).default({}),
}).strict();

/** 保存：expectedRevision 比较；执行相关内容变化才生成新修订并自动测试，只改说明不生成（P3）。 */
export const SaveComputeProfileRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  description: DescriptionTextSchema.optional(),
  content: ComputeProfileContentSchema,
  credentials: z.record(EnvNameSchema, ProfileCredentialWriteSchema).default({}),
}).strict();

export const SetComputeProfileEnabledRequestSchema = z.object({ enabled: z.boolean() }).strict();
export const CopyComputeProfileRequestSchema = z.object({ name: ComputeProfileNameSchema, description: DescriptionTextSchema.optional() }).strict();
export const StartProfileTestRequestSchema = z.object({ clientRequestId: z.uuid() }).strict();
/** 删除被已上线版本引用的档位须显式确认（C19）。 */
export const DeleteComputeProfileQuerySchema = z.object({ confirmReferences: z.enum(['true', 'false']).optional() });

/** 测试状态：superseded＝档位又保存了新修订，这条测试作废；unknown＝测试环境中途丢失，无法确认结果。 */
export const ProfileTestStateSchema = z.enum(['queued', 'running', 'passed', 'failed', 'unknown', 'superseded']);
/** 失败归类：已知协议沿用 agent-workflow 的冒烟分类，另加镜像、Runner、启动前步骤与终端命令几段。 */
export const ProfileTestOutcomeSchema = z.enum([
  'passed', 'image-pull-failed', 'runner-unavailable', 'runner-protocol-mismatch', 'before-start-failed',
  'spawn-failed', 'auth-missing', 'network-blocked', 'model-call-failed', 'stream-nonconforming', 'output-mismatch', 'timeout', 'environment-lost',
]);
export const ProfileTestStageStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);
/** 阶段：镜像 → Runner 握手 → 每个启动前步骤 → CLI 启动 → 模型轮次（已知协议）或测试命令（通用终端）。 */
export const ProfileTestStageSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'runner', 'step', 'launch', 'model', 'command']),
  name: z.string().min(1),
  stepId: StepIdSchema.optional(),
  state: ProfileTestStageStateSchema,
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** 脱敏细节：路径、退出码、变量名、回文摘录；不含密钥、脚本源码或文件正文。 */
  detail: z.string().max(4096).optional(),
  exitCode: z.number().int().nullable().optional(),
  log: z.object({ stdoutTail: z.string(), stderrTail: z.string() }).optional(),
  error: BeforeStartErrorSchema.extend({ code: z.string() }).optional(),
});

/** 测试上下文：平台命名空间可达不等于所有项目可达，结果页必须原样注明。 */
export const ProfileTestContextSchema = z.object({
  kind: z.literal('platform-namespace'),
  taskId: TaskIdSchema.optional(),
  image: z.string().optional(),
  imageDigest: z.string().optional(),
  runnerProtocol: z.number().int().optional(),
  cliVersion: z.string().nullable().optional(),
  interpreters: z.array(RunnerInterpreterSchema).optional(),
  workdir: z.string().optional(),
});

export const ProfileTestDtoSchema = z.object({
  testId: ProfileTestIdSchema,
  profile: SlugSchema,
  revision: z.number().int().min(1),
  contentHash: z.string().min(1),
  trigger: z.enum(['save', 'manual']),
  state: ProfileTestStateSchema,
  outcome: ProfileTestOutcomeSchema.optional(),
  stages: z.array(ProfileTestStageSchema),
  context: ProfileTestContextSchema,
  error: z.string().optional(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
});

/** 租户能不能选：停用、测试中、测试失败、尚未测试都不能选；原因写成管理员能处理的话。 */
export const ComputeProfileAvailabilitySchema = z.object({
  state: z.enum(['ready', 'disabled', 'testing', 'test-failed', 'untested']),
  available: z.boolean(),
  reason: z.string().optional(),
});

export const ComputeProfileListItemSchema = z.object({
  name: SlugSchema,
  protocol: AgentProtocolSchema,
  description: z.string(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  revision: z.number().int().min(1),
  image: z.string(),
  imageDigest: z.string(),
  binaryPath: z.string(),
  model: z.string().optional(),
  taskProfile: SlugSchema.optional(),
  availability: ComputeProfileAvailabilitySchema,
  latestTest: ProfileTestDtoSchema.optional(),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
});

export const ComputeProfileDetailDtoSchema = ComputeProfileListItemSchema.extend({
  content: ComputeProfileContentSchema,
  contentHash: z.string().min(1),
  credentials: z.array(ProfileCredentialStateSchema),
  /** 引用它的项目（按 preview／prod 两槽当前版本的 Manifest 按名称统计，P8）。 */
  referencedBy: z.array(z.string()),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});

export const ComputeProfileListSchema = z.object({ items: z.array(ComputeProfileListItemSchema) });

/** 删除被引用档位而未确认时的 409 details。 */
export const ComputeProfileReferencesSchema = z.object({ code: z.literal('profile_referenced'), projects: z.array(z.string()) });

/** 租户面投影（沿用 RFC-001 的按角色裁剪）：够画下拉，不泄露镜像、二进制与模型。 */
export const ComputeProfileSummaryDtoSchema = z.object({
  name: SlugSchema,
  description: z.string().default(''),
  /** 通用终端协议：只能用于「＋ CLI」，没有 Agent 动态。 */
  terminalOnly: z.boolean(),
  isDefault: z.boolean(),
  available: z.boolean(),
  reason: z.string().optional(),
});

/** 管理页的推送信息卡（C18）：推送主机、可推送的仓库前缀、平台底座镜像与示例 Dockerfile。 */
export const RuntimeImagesInfoSchema = z.object({
  pushHost: z.string(),
  repositoryPrefix: z.string(),
  pullReference: z.string(),
  baseImage: z.object({ reference: z.string(), pushHostReference: z.string(), digest: z.string().optional(), error: z.string().optional() }),
  sampleDockerfile: z.string(),
});

/** 签发的推送凭据：只在这次响应里出现一次；到期后仓库拒绝。 */
export const RegistryPushCredentialSchema = z.object({
  pushHost: z.string(),
  username: z.string(),
  password: z.string(),
  expiresAt: z.iso.datetime(),
  pushPrefixes: z.array(z.string()),
  pullPrefixes: z.array(z.string()),
});

export type ComputeUsage = z.infer<typeof ComputeUsageSchema>;
export type TerminalTest = z.infer<typeof TerminalTestSchema>;
export type ComputeProfileContent = z.infer<typeof ComputeProfileContentSchema>;
export type ProfileCredentialWrite = z.infer<typeof ProfileCredentialWriteSchema>;
export type ProfileCredentialState = z.infer<typeof ProfileCredentialStateSchema>;
export type CreateComputeProfileRequest = z.infer<typeof CreateComputeProfileRequestSchema>;
export type SaveComputeProfileRequest = z.infer<typeof SaveComputeProfileRequestSchema>;
export type SetComputeProfileEnabledRequest = z.infer<typeof SetComputeProfileEnabledRequestSchema>;
export type CopyComputeProfileRequest = z.infer<typeof CopyComputeProfileRequestSchema>;
export type StartProfileTestRequest = z.infer<typeof StartProfileTestRequestSchema>;
export type ProfileTestState = z.infer<typeof ProfileTestStateSchema>;
export type ProfileTestOutcome = z.infer<typeof ProfileTestOutcomeSchema>;
export type ProfileTestStageState = z.infer<typeof ProfileTestStageStateSchema>;
export type ProfileTestStage = z.infer<typeof ProfileTestStageSchema>;
export type ProfileTestContext = z.infer<typeof ProfileTestContextSchema>;
export type ProfileTestDto = z.infer<typeof ProfileTestDtoSchema>;
export type ComputeProfileAvailability = z.infer<typeof ComputeProfileAvailabilitySchema>;
export type ComputeProfileListItem = z.infer<typeof ComputeProfileListItemSchema>;
export type ComputeProfileDetailDto = z.infer<typeof ComputeProfileDetailDtoSchema>;
export type ComputeProfileList = z.infer<typeof ComputeProfileListSchema>;
export type ComputeProfileSummaryDto = z.infer<typeof ComputeProfileSummaryDtoSchema>;
export type RuntimeImagesInfo = z.infer<typeof RuntimeImagesInfoSchema>;
export type RegistryPushCredential = z.infer<typeof RegistryPushCredentialSchema>;
/** 客户端发送的写请求（zod 输入类型）：带默认值的嵌套字段可省略，服务端按 Schema 补齐。 */
export type CreateComputeProfileInput = z.input<typeof CreateComputeProfileRequestSchema>;
export type SaveComputeProfileInput = z.input<typeof SaveComputeProfileRequestSchema>;
export type ComputeProfileContentInput = z.input<typeof ComputeProfileContentSchema>;
