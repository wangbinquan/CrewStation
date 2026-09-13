import { z } from 'zod';
import { ProjectIdSchema } from '../../ids';
import { ApiRequestDtoSchema } from '../apiCatalog';
import { EgressRequestDtoSchema } from '../egress';
import { ProjectDtoSchema } from '../project';

/** 筛选在服务端分页前生效；旧全量接口继续兼容已有调用方。 */
export const RequestPageQuerySchema = z.object({
  projectId: ProjectIdSchema.optional(),
  state: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(2048).optional(),
});
export const RequestProjectSchema = ProjectDtoSchema.pick({ id: true, name: true, slug: true, kind: true });
export const ApiRequestPageItemSchema = ApiRequestDtoSchema.extend({ projectId: ProjectIdSchema, project: RequestProjectSchema.optional() });
export const EgressRequestPageItemSchema = EgressRequestDtoSchema.extend({ project: RequestProjectSchema.optional() });
export const ApiRequestPageSchema = z.object({ items: z.array(ApiRequestPageItemSchema).max(50), nextCursor: z.string().min(1).max(2048).optional() });
export const EgressRequestPageSchema = z.object({ items: z.array(EgressRequestPageItemSchema).max(50), nextCursor: z.string().min(1).max(2048).optional() });
export type RequestPageQuery = z.infer<typeof RequestPageQuerySchema>;
export type ApiRequestPage = z.infer<typeof ApiRequestPageSchema>;
export type EgressRequestPage = z.infer<typeof EgressRequestPageSchema>;
