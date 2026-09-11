import { z } from 'zod';
import { UserIdSchema } from '../ids';

export const ConfigEnvSchema = z.enum(['production', 'development']);

export const ConfigItemDtoSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  env: ConfigEnvSchema,
  isSecret: z.boolean(),
  /** Secret 只写不读：isSecret 时永远不返回值。 */
  value: z.string().optional(),
  version: z.number().int().min(1),
  updatedBy: UserIdSchema,
  updatedAt: z.iso.datetime(),
});

export const SetConfigItemRequestSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  env: ConfigEnvSchema,
  value: z.string(),
  isSecret: z.boolean().default(false),
});

export const ConfigVersionDtoSchema = z.object({
  env: ConfigEnvSchema,
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  keys: z.array(z.string()),
});

export type ConfigEnv = z.infer<typeof ConfigEnvSchema>;
export type ConfigItemDto = z.infer<typeof ConfigItemDtoSchema>;
export type SetConfigItemRequest = z.infer<typeof SetConfigItemRequestSchema>;
