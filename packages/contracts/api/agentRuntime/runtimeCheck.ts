import { z } from 'zod';
import { RuntimeCheckIdSchema, RuntimeConfigIdSchema, TaskIdSchema, UserIdSchema } from '../../ids';
import { BeforeStartErrorSchema, RunnerInterpreterSchema, StepIdSchema } from '../../taskrunner/beforeStart';

export const StartRuntimeCheckRequestSchema = z.object({
  revision: z.number().int().min(1),
  /** 双击、重发与断线重试沿用同一 ID，只查回原检查。 */
  clientRequestId: z.uuid(),
  /** 测试用的模型名；缺省用版本的默认模型。 */
  model: z.string().min(1).max(200).optional(),
}).strict();

/** unknown：检查任务或 Runner 中途丢失，无法确认脚本是否已执行；不自动重跑。 */
export const RuntimeCheckStateSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'unknown']);
export const RuntimeCheckStageStateSchema = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped']);

/** 阶段：输入校验 → 每个 Hook 步骤 → 最终 CLI 配置校验 → 真实模型响应。 */
export const RuntimeCheckStageSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['input', 'step', 'cli-config', 'model']),
  name: z.string().min(1),
  stepId: StepIdSchema.optional(),
  state: RuntimeCheckStageStateSchema,
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
  durationMs: z.number().int().min(0).optional(),
  /** 脱敏细节：文件路径、退出码、变量名、模型回应摘要；不含密钥、脚本源码或文件正文。 */
  detail: z.string().max(4096).optional(),
  exitCode: z.number().int().nullable().optional(),
  log: z.object({ stdoutTail: z.string(), stderrTail: z.string() }).optional(),
  error: BeforeStartErrorSchema.extend({ code: z.string() }).optional(),
});

/** 检查执行的上下文：平台命名空间可达不等于所有项目可达，结果页必须原样注明。 */
export const RuntimeCheckContextSchema = z.object({
  kind: z.literal('platform-namespace'),
  taskId: TaskIdSchema.optional(),
  image: z.string().optional(),
  imageDigest: z.string().optional(),
  cliVersion: z.string().nullable().optional(),
  interpreters: z.array(RunnerInterpreterSchema).optional(),
  workdir: z.string().optional(),
});

export const RuntimeCheckDtoSchema = z.object({
  checkId: RuntimeCheckIdSchema,
  configId: RuntimeConfigIdSchema,
  revision: z.number().int().min(1),
  contentHash: z.string().min(1),
  clientRequestId: z.uuid(),
  model: z.string().optional(),
  state: RuntimeCheckStateSchema,
  context: RuntimeCheckContextSchema,
  stages: z.array(RuntimeCheckStageSchema),
  error: z.string().optional(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  endedAt: z.iso.datetime().optional(),
});

export type StartRuntimeCheckRequest = z.infer<typeof StartRuntimeCheckRequestSchema>;
export type RuntimeCheckState = z.infer<typeof RuntimeCheckStateSchema>;
export type RuntimeCheckStageState = z.infer<typeof RuntimeCheckStageStateSchema>;
export type RuntimeCheckStage = z.infer<typeof RuntimeCheckStageSchema>;
export type RuntimeCheckContext = z.infer<typeof RuntimeCheckContextSchema>;
export type RuntimeCheckDto = z.infer<typeof RuntimeCheckDtoSchema>;
