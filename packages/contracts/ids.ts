import { z } from 'zod';

const prefixed = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{32}$`), `${prefix} ID 格式不正确`);

export const ProjectIdSchema = prefixed('prj').brand<'ProjectId'>();
export const ServiceIdSchema = prefixed('svc').brand<'ServiceId'>();
export const UserIdSchema = prefixed('usr').brand<'UserId'>();
export const ReleaseIdSchema = prefixed('rel').brand<'ReleaseId'>();
export const TaskIdSchema = prefixed('tsk').brand<'TaskId'>();
export const SubtaskIdSchema = prefixed('sub').brand<'SubtaskId'>();
export const EventIdSchema = prefixed('evt').brand<'EventId'>();
export const OperationIdSchema = prefixed('op').brand<'OperationId'>();
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
export type TraceId = z.infer<typeof TraceIdSchema>;
export type Slug = z.infer<typeof SlugSchema>;
