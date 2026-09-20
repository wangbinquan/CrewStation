import { z } from 'zod';
import { ResourceIdSchema, UserIdSchema } from '../ids';

export const ConfigEnvSchema = z.enum(['production', 'development']);

/** 配置项名与 Manifest env 段的环境变量名同形：大写蛇形。 */
export const ConfigNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/, '配置项名必须是大写蛇形');

export const ConfigDefinitionDtoSchema = z.object({ id: ResourceIdSchema, name: z.string().min(1).max(120), bindingName: ConfigNameSchema });
export type ConfigDefinitionDto = z.infer<typeof ConfigDefinitionDtoSchema>;

export const ConfigItemDtoSchema = z.object({
  id: ResourceIdSchema, definitionId: ResourceIdSchema, bindingName: ConfigNameSchema,
  name: z.string().min(1).max(120),
  env: ConfigEnvSchema,
  isSecret: z.boolean(),
  /** Secret 只写不读：isSecret 时永远不返回值。 */
  value: z.string().optional(),
  version: z.number().int().min(1),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
});

export const SetConfigItemRequestSchema = z.object({
  definitionId: ResourceIdSchema.optional(),
  bindingName: ConfigNameSchema,
  name: z.string().trim().min(1).max(120),
  expectedVersion: z.number().int().positive().optional(),
  env: ConfigEnvSchema,
  value: z.string(),
  isSecret: z.boolean().default(false),
});

export const ConfigVersionDtoSchema = z.object({
  env: ConfigEnvSchema,
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  keys: z.array(z.string()),
  entries: z.array(z.object({ itemId: ResourceIdSchema, definitionId: ResourceIdSchema, bindingName: ConfigNameSchema, name: z.string() })),
});

/** Manifest env 段对某取值组的校验结果：列出取值组中不存在的配置项键。 */
export const ManifestEnvValidationSchema = z.object({ missing: z.array(z.string()) });

export type ConfigEnv = z.infer<typeof ConfigEnvSchema>;
export type ConfigItemDto = z.infer<typeof ConfigItemDtoSchema>;
export type SetConfigItemRequest = z.infer<typeof SetConfigItemRequestSchema>;
export type ConfigVersionDto = z.infer<typeof ConfigVersionDtoSchema>;
export type ManifestEnvValidation = z.infer<typeof ManifestEnvValidationSchema>;
