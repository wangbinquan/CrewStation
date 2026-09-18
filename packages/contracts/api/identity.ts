import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../ids';
import { AuthMethodSchema } from './auth/session';

export const MemberRoleSchema = z.enum(['owner', 'developer', 'tester']);

export const CurrentUserDtoSchema = z.object({
  id: UserIdSchema,
  name: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  memberships: z.array(z.object({ projectId: ProjectIdSchema, role: MemberRoleSchema })),
  /** 本次会话是怎么建立的：本地用户名密码，或某个 OIDC Provider（RFC-005 §7.1）。 */
  authMethod: AuthMethodSchema,
});

export const UserDtoSchema = z.object({ id: UserIdSchema, name: z.string(), email: z.string(), isAdmin: z.boolean() });

/** 管理员设置或撤销另一用户的管理员标记。 */
export const SetAdminRequestSchema = z.object({ isAdmin: z.boolean() });

export type MemberRole = z.infer<typeof MemberRoleSchema>;
export type CurrentUserDto = z.infer<typeof CurrentUserDtoSchema>;
export type UserDto = z.infer<typeof UserDtoSchema>;
export type SetAdminRequest = z.infer<typeof SetAdminRequestSchema>;
