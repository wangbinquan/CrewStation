import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../ids';

/** 出站白名单（G23）：管理员维护全局清单，可按项目开放；项目可申请追加。 */
export const EgressEntryDtoSchema = z.object({
  id: z.string(),
  fqdn: z.string().regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'FQDN 形如 api.example.com 或 *.example.com'),
  scope: z.enum(['global', 'project']),
  projectId: ProjectIdSchema.optional(),
  note: z.string().optional(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});

export const EgressRequestDtoSchema = z.object({
  id: z.string(),
  projectId: ProjectIdSchema,
  fqdn: z.string(),
  reason: z.string().optional(),
  state: z.enum(['pending', 'approved', 'rejected']),
  requestedBy: UserIdSchema,
  decidedBy: UserIdSchema.optional(),
  decision: z.string().optional(),
  createdAt: z.iso.datetime(),
});

export const BlockedEgressDtoSchema = z.object({
  projectId: ProjectIdSchema,
  fqdn: z.string(),
  count: z.number().int().min(1),
  lastSeenAt: z.iso.datetime(),
  source: z.enum(['dev-session', 'business-task', 'build', 'slot']).optional(),
});

export type EgressEntryDto = z.infer<typeof EgressEntryDtoSchema>;
export type EgressRequestDto = z.infer<typeof EgressRequestDtoSchema>;
export type BlockedEgressDto = z.infer<typeof BlockedEgressDtoSchema>;
