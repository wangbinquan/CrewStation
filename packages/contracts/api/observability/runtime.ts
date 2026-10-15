import { z } from 'zod';
import { ProjectIdSchema } from '../../ids';

// RFC-034 v2（proposal/rfc/RFC-034-runtime-observability/redesign-v2-20261014.md §5）：
// 项目与系统两级运行统计的查询与返回形状。时间一律 ISO 字符串；人民币为纳元（10⁻⁹ 元）
// 的十进制整数字符串，避免全平台月度金额超出 JS 安全整数；Token 计数为安全整数。

export const AGENT_CALL_STATUSES = ['running', 'done', 'failed', 'canceled', 'interrupted'] as const;
export const AgentCallStatusSchema = z.enum(AGENT_CALL_STATUSES);
export const AGENT_CALL_SOURCES = ['business', 'development', 'platform'] as const;
export const AgentCallSourceSchema = z.enum(AGENT_CALL_SOURCES);
export const AGENT_CALL_KINDS = ['subtask', 'agent', 'cli', 'profile-test'] as const;
export const AgentCallKindSchema = z.enum(AGENT_CALL_KINDS);
export const AgentUsageStateSchema = z.enum(['pending', 'partial', 'complete', 'none']);
export const AgentCostStateSchema = z.enum(['none', 'priced', 'partial', 'unpriced']);

/** 统计窗口最长一年。 */
export const OBSERVATION_MAX_WINDOW_MS = 366 * 86_400_000;
const at = z.iso.datetime();
const nano = z.string().regex(/^(0|[1-9]\d{0,24})$/);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const window = {
  from: at,
  to: at,
  /** 浏览器当前的 UTC 偏移（分钟，东正西负），按它切日桶。 */
  tzOffset: z.coerce.number<number | string>().int().min(-840).max(840).default(0),
};
const ordered = (value: { from: string; to: string }) => {
  const span = Date.parse(value.to) - Date.parse(value.from);
  return span > 0 && span <= OBSERVATION_MAX_WINDOW_MS;
};
const windowMessage = { message: '统计窗口须开始早于结束且不超过一年' };

export const ObservationWindowQuerySchema = z.strictObject(window).refine(ordered, windowMessage);
export const ObservationTaskPageQuerySchema = z
  .strictObject({
    ...window,
    q: z.string().trim().min(1).max(200).optional(),
    source: AgentCallSourceSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine(ordered, windowMessage);
export const ObservationPlatformQuerySchema = z
  .strictObject({ ...window, cursor: z.string().min(1).max(512).optional() })
  .refine(ordered, windowMessage);

export const ObservationUsageSchema = z.strictObject({
  calls: count,
  /** 用量不完整（partial / pending / none）的执行数：合计是已知下界。 */
  incompleteCalls: count,
  /** 失败或中断的执行数。 */
  failedCalls: count,
  input: count,
  cacheRead: count,
  cacheWrite: count,
  /** 含推理。 */
  output: count,
  reasoning: count,
  /** 人民币纳元；费用对当前视角不可见时为 null。 */
  costNano: nano.nullable(),
  /** 有 Token 但未定价或部分定价的执行数。 */
  unpricedCalls: count,
});

export const ObservationModelUsageSchema = z.strictObject({
  model: z.string(),
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  /** null：未定价，或费用不可见。 */
  costNano: nano.nullable(),
});

export const ObservationCallSchema = z.strictObject({
  id: z.string(),
  source: AgentCallSourceSchema,
  kind: AgentCallKindSchema,
  projectId: ProjectIdSchema.nullable(),
  taskId: z.string(),
  taskLabel: z.string(),
  subtaskId: z.string().nullable(),
  attempt: z.number().int().positive().nullable(),
  agentKey: z.string(),
  agentLabel: z.string(),
  profileId: z.string().nullable(),
  profileName: z.string().nullable(),
  profileRevision: z.number().int().nonnegative().nullable(),
  protocol: z.string(),
  status: AgentCallStatusSchema,
  startedAt: at,
  endedAt: at.nullable(),
  usageState: AgentUsageStateSchema,
  costState: AgentCostStateSchema,
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count,
  costNano: nano.nullable(),
  models: z.array(ObservationModelUsageSchema),
});

const ranked = { usage: ObservationUsageSchema };
export const ObservationTaskRefSchema = z.strictObject({
  taskId: z.string(), source: AgentCallSourceSchema, label: z.string(), projectId: ProjectIdSchema.nullable(), ...ranked,
});
export const ObservationAgentRowSchema = z.strictObject({
  agentKey: z.string(), agentLabel: z.string(), tasks: count, durationMs: count, ...ranked,
});
export const ObservationProjectRowSchema = z.strictObject({
  projectId: ProjectIdSchema, projectName: z.string().nullable(), tasks: count, ...ranked,
});

export const ObservationOverviewSchema = z.strictObject({
  asOf: at,
  from: at,
  to: at,
  costVisible: z.boolean(),
  usage: ObservationUsageSchema,
  bySource: z.strictObject({ business: ObservationUsageSchema, development: ObservationUsageSchema, platform: ObservationUsageSchema }),
  statuses: z.strictObject({ running: count, done: count, failed: count, canceled: count, interrupted: count }),
  /** 已结束执行的时长分布（毫秒）。 */
  durations: z.strictObject({ samples: count, p50: count.nullable(), p95: count.nullable(), max: count.nullable() }),
  daily: z.array(z.strictObject({
    day: z.string(), calls: count, input: count, cacheRead: count, cacheWrite: count, output: count, costNano: nano.nullable(),
  })),
  topTasks: z.array(ObservationTaskRefSchema),
  topAgents: z.array(ObservationAgentRowSchema),
  /** 仅系统视角。 */
  topProjects: z.array(ObservationProjectRowSchema),
});

export const ObservationTaskRowSchema = z.strictObject({
  taskId: z.string(),
  source: AgentCallSourceSchema,
  label: z.string(),
  projectId: ProjectIdSchema.nullable(),
  firstStartedAt: at,
  lastEndedAt: at.nullable(),
  running: z.boolean(),
  agents: count,
  usage: ObservationUsageSchema,
});
export const ObservationTaskPageSchema = z.strictObject({
  asOf: at, costVisible: z.boolean(), items: z.array(ObservationTaskRowSchema), nextCursor: z.string().nullable(),
});
export const ObservationTaskDetailSchema = z.strictObject({
  asOf: at,
  costVisible: z.boolean(),
  task: z.strictObject({ taskId: z.string(), source: AgentCallSourceSchema, label: z.string(), projectId: ProjectIdSchema.nullable() }),
  usage: ObservationUsageSchema,
  calls: z.array(ObservationCallSchema),
  /** 执行数超过一次返回的上限。 */
  truncated: z.boolean(),
});
const listed = <T extends z.ZodType>(row: T) =>
  z.strictObject({ asOf: at, costVisible: z.boolean(), truncated: z.boolean(), items: z.array(row) });
export const ObservationAgentPageSchema = listed(ObservationAgentRowSchema);
export const ObservationModelRowSchema = z.strictObject({
  profileId: z.string().nullable(), profileName: z.string().nullable(), protocol: z.string(), model: z.string(), usage: ObservationUsageSchema,
});
export const ObservationModelPageSchema = listed(ObservationModelRowSchema);
export const ObservationProjectPageSchema = listed(ObservationProjectRowSchema);
export const ObservationPlatformPageSchema = z.strictObject({
  asOf: at,
  kinds: z.array(z.strictObject({ kind: AgentCallKindSchema, usage: ObservationUsageSchema })),
  recent: z.array(ObservationCallSchema),
  nextCursor: z.string().nullable(),
});

// -- 人民币价格线（系统管理 → 算力档位 → Token 成本）----------------------------------

/** 元 / 百万 Token，最多 6 位小数；null 为未知（不是免费），0 为明确免费。 */
export const ObservationRateSchema = z.string().regex(/^(0|[1-9]\d{0,8})(\.\d{1,6})?$/, '人民币单价须为非负小数，最多 6 位小数').nullable();
export const ObservationRatesSchema = z.strictObject({
  input: ObservationRateSchema, cacheRead: ObservationRateSchema, cacheWrite: ObservationRateSchema, output: ObservationRateSchema,
});
export const SaveObservationPriceSchema = z.strictObject({
  model: z.string().trim().min(1).max(300),
  rates: ObservationRatesSchema,
  effectiveFrom: at,
  note: z.string().trim().max(2000).default(''),
  /** 以这条价格线最新版本做比较并设置。 */
  expectedLatestId: z.string().min(1).max(64).nullable(),
});
export const ObservationPriceSchema = z.strictObject({
  id: z.string(),
  profileId: z.string(),
  model: z.string(),
  rates: ObservationRatesSchema,
  effectiveFrom: at,
  createdAt: at,
  createdBy: z.string(),
  note: z.string(),
});
export const ObservationPricingProfileSchema = z.strictObject({
  profileId: z.string(),
  name: z.string(),
  protocol: z.string(),
  /** 没有算力档位的平台执行所用的协议内置价格线（键 `builtin:<protocol>`）。 */
  builtin: z.boolean(),
  configuredModel: z.string().nullable(),
  models: z.array(z.strictObject({ model: z.string(), calls: count, current: ObservationPriceSchema.nullable() })),
});
export const ObservationPricingDirectorySchema = z.strictObject({ profiles: z.array(ObservationPricingProfileSchema) });
export const ObservationPriceHistorySchema = z.strictObject({ items: z.array(ObservationPriceSchema) });

/** 项目页与项目成员是否看得到人民币估值；默认不可见，系统页始终可见。 */
export const ProjectCostVisibilitySchema = z.strictObject({
  projectId: ProjectIdSchema, visible: z.boolean(), updatedAt: at.nullable(),
});
export const SetProjectCostVisibilitySchema = z.strictObject({ visible: z.boolean() });

export type AgentCallStatus = z.infer<typeof AgentCallStatusSchema>;
export type AgentCallSource = z.infer<typeof AgentCallSourceSchema>;
export type AgentCallKind = z.infer<typeof AgentCallKindSchema>;
export type AgentUsageState = z.infer<typeof AgentUsageStateSchema>;
export type AgentCostState = z.infer<typeof AgentCostStateSchema>;
export type ObservationWindowQuery = z.infer<typeof ObservationWindowQuerySchema>;
export type ObservationTaskPageQuery = z.infer<typeof ObservationTaskPageQuerySchema>;
export type ObservationPlatformQuery = z.infer<typeof ObservationPlatformQuerySchema>;
export type ObservationUsage = z.infer<typeof ObservationUsageSchema>;
export type ObservationModelUsage = z.infer<typeof ObservationModelUsageSchema>;
export type ObservationCall = z.infer<typeof ObservationCallSchema>;
export type ObservationTaskRef = z.infer<typeof ObservationTaskRefSchema>;
export type ObservationAgentRow = z.infer<typeof ObservationAgentRowSchema>;
export type ObservationProjectRow = z.infer<typeof ObservationProjectRowSchema>;
export type ObservationOverview = z.infer<typeof ObservationOverviewSchema>;
export type ObservationTaskRow = z.infer<typeof ObservationTaskRowSchema>;
export type ObservationTaskPage = z.infer<typeof ObservationTaskPageSchema>;
export type ObservationTaskDetail = z.infer<typeof ObservationTaskDetailSchema>;
export type ObservationAgentPage = z.infer<typeof ObservationAgentPageSchema>;
export type ObservationModelRow = z.infer<typeof ObservationModelRowSchema>;
export type ObservationModelPage = z.infer<typeof ObservationModelPageSchema>;
export type ObservationProjectPage = z.infer<typeof ObservationProjectPageSchema>;
export type ObservationPlatformPage = z.infer<typeof ObservationPlatformPageSchema>;
export type ObservationRates = z.infer<typeof ObservationRatesSchema>;
export type SaveObservationPrice = z.infer<typeof SaveObservationPriceSchema>;
export type SaveObservationPriceInput = z.input<typeof SaveObservationPriceSchema>;
export type ObservationPrice = z.infer<typeof ObservationPriceSchema>;
export type ObservationPricingProfile = z.infer<typeof ObservationPricingProfileSchema>;
export type ObservationPricingDirectory = z.infer<typeof ObservationPricingDirectorySchema>;
export type ObservationPriceHistory = z.infer<typeof ObservationPriceHistorySchema>;
export type ProjectCostVisibility = z.infer<typeof ProjectCostVisibilitySchema>;
export type SetProjectCostVisibility = z.infer<typeof SetProjectCostVisibilitySchema>;

const RATE_PATTERN = /^(0|[1-9]\d{0,8})(?:\.(\d{1,6}))?$/;
/** `"2.5"` → 2_500_000（微元 / 百万 Token）。 */
export function observationRateToMicro(rate: string): number {
  const match = RATE_PATTERN.exec(rate);
  if (!match) throw new RangeError('invalid-rate');
  return Number(match[1]) * 1_000_000 + Number((match[2] ?? '').padEnd(6, '0') || '0');
}
/** 2_500_000 → `"2.5"`。 */
export function observationMicroToRate(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const fraction = String(micro % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
/** 纳元字符串 → `¥` 金额，最多 6 位小数；非零但小于 ¥0.000001 单独标出。 */
export function formatObservationCny(nanoText: string): string {
  const value = BigInt(nanoText);
  if (value > 0n && value < 1000n) return '< ¥0.000001';
  const micro = (value + 500n) / 1000n;
  const whole = micro / 1_000_000n;
  const fraction = String(micro % 1_000_000n).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `¥${whole.toLocaleString('en-US')}.${fraction}`;
}
/** 没有算力档位的执行所用的协议内置价格线键。 */
export function observationBuiltinProfileId(protocol: string): string {
  return `builtin:${protocol}`;
}
/** 内置价格线键对应的协议；档位 ID 返回 null。 */
export function observationBuiltinProtocol(profileId: string | null): string | null {
  return profileId !== null && profileId.startsWith('builtin:') ? profileId.slice('builtin:'.length) : null;
}
