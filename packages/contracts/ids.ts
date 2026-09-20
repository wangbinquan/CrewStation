import { z } from 'zod';

/** RFC-013：完整、小写 UUIDv7；名称与协议符号不得作为资源身份传入。 */
export const ResourceIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, '资源 ID 必须是完整的小写 UUIDv7');

export const ProjectIdSchema = ResourceIdSchema.brand<'ProjectId'>();
export const ServiceIdSchema = ResourceIdSchema.brand<'ServiceId'>();
export const UserIdSchema = ResourceIdSchema.brand<'UserId'>();
export const ReleaseIdSchema = ResourceIdSchema.brand<'ReleaseId'>();
export const TaskIdSchema = ResourceIdSchema.brand<'TaskId'>();
export const SubtaskIdSchema = ResourceIdSchema.brand<'SubtaskId'>();
export const EventIdSchema = ResourceIdSchema.brand<'EventId'>();
export const OperationIdSchema = ResourceIdSchema.brand<'OperationId'>();
/** RFC-004：管理员运行环境配置与其检查记录。 */
/** RFC-006：一次算力档位测试。 */
export const ProfileTestIdSchema = ResourceIdSchema.brand<'ProfileTestId'>();
/** RFC-005：OIDC 身份提供方与一条外部身份关联。 */
export const OidcProviderIdSchema = ResourceIdSchema.brand<'OidcProviderId'>();
export const UserIdentityIdSchema = ResourceIdSchema.brand<'UserIdentityId'>();
export const TraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'traceId 必须是 32 位十六进制').brand<'TraceId'>();

/** 对外可见的短名：项目 slug、服务名、代理名、事件类型片段都用它。 */
export const SlugSchema = z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, 'slug 只允许小写字母、数字与连字符，3–40 位');

export type ProjectId = z.infer<typeof ProjectIdSchema>;
export type ServiceId = z.infer<typeof ServiceIdSchema>;
export type UserId = z.infer<typeof UserIdSchema>;
export type ReleaseId = z.infer<typeof ReleaseIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type SubtaskId = z.infer<typeof SubtaskIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type OperationId = z.infer<typeof OperationIdSchema>;
export type ProfileTestId = z.infer<typeof ProfileTestIdSchema>;
export type OidcProviderId = z.infer<typeof OidcProviderIdSchema>;
export type UserIdentityId = z.infer<typeof UserIdentityIdSchema>;
export type TraceId = z.infer<typeof TraceIdSchema>;
export type Slug = z.infer<typeof SlugSchema>;
