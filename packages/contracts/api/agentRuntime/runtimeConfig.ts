import { z } from 'zod';
import { RuntimeConfigIdSchema, SlugSchema, UserIdSchema } from '../../ids';
import { BeforeStartStepsSchema, ConfigFileBindingSchema, EnvNameSchema, RuntimeDriverSchema } from '../../taskrunner/beforeStart';

/** 草稿 → 检查通过／失败 → 已启用 → 已停用；启用后再改草稿仍显示“已启用”，草稿状态另见 draftRevision 与 activeRevision 是否相等。 */
export const RuntimeConfigStatusSchema = z.enum(['draft', 'checked', 'check-failed', 'active', 'disabled']);

/** 建档预设：只决定初始步骤与配置绑定，建档后与空白环境无差别。 */
export const RuntimeConfigPresetSchema = z.enum(['claude-settings', 'opencode-config', 'blank']);

export const RuntimeConfigDescriptionSchema = z.string().max(500).default('');
const ModelNameSchema = z.string().min(1).max(200);

export const CreateRuntimeConfigRequestSchema = z.object({
  name: SlugSchema,
  description: RuntimeConfigDescriptionSchema,
  driver: RuntimeDriverSchema,
  preset: RuntimeConfigPresetSchema.default('blank'),
}).strict();

/** 凭据写操作三选一；GET 从不返回原值或可重用密文。 */
export const RuntimeCredentialWriteSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('keep') }).strict(),
  z.object({ op: z.literal('replace'), value: z.string().min(1).max(65536) }).strict(),
  z.object({ op: z.literal('clear') }).strict(),
]);

/** 一个不可变版本的内容（不含密钥值）。 */
export const RuntimeConfigRevisionDtoSchema = z.object({
  revision: z.number().int().min(1),
  steps: BeforeStartStepsSchema,
  vars: z.record(EnvNameSchema, z.string().max(65536)),
  /** 版本引用的凭据名；值只在启动材料里出现。 */
  secretNames: z.array(EnvNameSchema),
  configFile: ConfigFileBindingSchema,
  defaultModel: ModelNameSchema.optional(),
  /** 档位可绑定的模型名；空表示不限制。 */
  models: z.array(ModelNameSchema).max(64),
  contentHash: z.string().min(1),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});

export const SaveRuntimeDraftRequestSchema = z.object({
  expectedRevision: z.number().int().min(1),
  description: RuntimeConfigDescriptionSchema.optional(),
  steps: BeforeStartStepsSchema,
  vars: z.record(EnvNameSchema, z.string().max(65536)).default({}),
  /** 版本声明的凭据名；模板只能引用这里列出的名字，值经 credentials 单独写入。 */
  secretNames: z.array(EnvNameSchema).max(64).default([]),
  credentials: z.record(EnvNameSchema, RuntimeCredentialWriteSchema).default({}),
  configFile: ConfigFileBindingSchema,
  defaultModel: ModelNameSchema.optional(),
  models: z.array(ModelNameSchema).max(64).default([]),
}).strict();

/** 已声明的凭据：只说有没有值、谁何时改的；从不返回原值或密文。 */
export const RuntimeCredentialStateSchema = z.object({ name: EnvNameSchema, set: z.boolean(), updatedBy: UserIdSchema.optional(), updatedAt: z.iso.datetime().optional() });

export const RuntimeConfigDtoSchema = z.object({
  id: RuntimeConfigIdSchema,
  name: SlugSchema,
  description: z.string(),
  driver: RuntimeDriverSchema,
  status: RuntimeConfigStatusSchema,
  draftRevision: z.number().int().min(1),
  activeRevision: z.number().int().min(1).nullable(),
  enabled: z.boolean(),
  /** 引用它的算力档位数；被引用时只能停用不能删除。 */
  referencedProfiles: z.number().int().min(0),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
});

export const RuntimeConfigDetailDtoSchema = RuntimeConfigDtoSchema.extend({
  draft: RuntimeConfigRevisionDtoSchema,
  active: RuntimeConfigRevisionDtoSchema.optional(),
  credentials: z.array(RuntimeCredentialStateSchema),
  referencedBy: z.array(SlugSchema),
  /** 草稿版本的最近一次检查 ID；启用时须引用检查通过的那一次。 */
  latestCheckId: z.string().optional(),
});

export const RuntimeConfigListQuerySchema = z.object({
  name: z.string().max(40).optional(),
  driver: RuntimeDriverSchema.optional(),
  status: RuntimeConfigStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
export const RuntimeConfigPageSchema = z.object({ items: z.array(RuntimeConfigDtoSchema).max(50), nextCursor: z.string().min(1).max(2048).optional() });

export const ActivateRuntimeConfigRequestSchema = z.object({
  /** 当前已启用版本；null 表示尚未启用过。旧确认与实际不符即拒绝。 */
  expectedActiveRevision: z.number().int().min(1).nullable(),
  revision: z.number().int().min(1),
  checkId: z.string().min(1),
}).strict();

export const DisableRuntimeConfigRequestSchema = z.object({ expectedActiveRevision: z.number().int().min(1) }).strict();

export type RuntimeConfigStatus = z.infer<typeof RuntimeConfigStatusSchema>;
export type RuntimeConfigPreset = z.infer<typeof RuntimeConfigPresetSchema>;
export type CreateRuntimeConfigRequest = z.infer<typeof CreateRuntimeConfigRequestSchema>;
export type RuntimeCredentialWrite = z.infer<typeof RuntimeCredentialWriteSchema>;
export type RuntimeConfigRevisionDto = z.infer<typeof RuntimeConfigRevisionDtoSchema>;
export type SaveRuntimeDraftRequest = z.infer<typeof SaveRuntimeDraftRequestSchema>;
export type RuntimeCredentialState = z.infer<typeof RuntimeCredentialStateSchema>;
export type RuntimeConfigDto = z.infer<typeof RuntimeConfigDtoSchema>;
export type RuntimeConfigDetailDto = z.infer<typeof RuntimeConfigDetailDtoSchema>;
export type RuntimeConfigListQuery = z.infer<typeof RuntimeConfigListQuerySchema>;
export type RuntimeConfigPage = z.infer<typeof RuntimeConfigPageSchema>;
export type ActivateRuntimeConfigRequest = z.infer<typeof ActivateRuntimeConfigRequestSchema>;
export type DisableRuntimeConfigRequest = z.infer<typeof DisableRuntimeConfigRequestSchema>;
