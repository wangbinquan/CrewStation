import { z } from 'zod';
import { ServiceIdSchema } from '../ids';

/** 每逻辑服务唯一的源码仓库绑定（R32）。 */
export const RepositoryBindingDtoSchema = z.object({
  serviceId: ServiceIdSchema,
  provider: z.literal('gitlab'),
  remoteProjectId: z.string(),
  pathWithNamespace: z.string(),
  httpUrl: z.url(),
  defaultBranch: z.string(),
  state: z.enum(['creating', 'ready', 'failed']),
  message: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const TagDtoSchema = z.object({ name: z.string(), commitSha: z.string(), createdAt: z.iso.datetime(), protected: z.boolean() });

export type RepositoryBindingDto = z.infer<typeof RepositoryBindingDtoSchema>;
export type TagDto = z.infer<typeof TagDtoSchema>;
