import { z } from 'zod';
import { ProjectIdSchema, UserIdSchema } from '../ids';

export const MemberRoleSchema = z.enum(['owner', 'developer', 'tester']);

export const CurrentUserDtoSchema = z.object({
  id: UserIdSchema,
  name: z.string(),
  email: z.string(),
  isAdmin: z.boolean(),
  memberships: z.array(z.object({ projectId: ProjectIdSchema, role: MemberRoleSchema })),
  /** 演示身份适配器登录时为 true，工作台必须显式标注。 */
  demoIdentity: z.boolean(),
});

export const UserDtoSchema = z.object({ id: UserIdSchema, name: z.string(), email: z.string(), isAdmin: z.boolean() });

export type MemberRole = z.infer<typeof MemberRoleSchema>;
export type CurrentUserDto = z.infer<typeof CurrentUserDtoSchema>;
export type UserDto = z.infer<typeof UserDtoSchema>;
