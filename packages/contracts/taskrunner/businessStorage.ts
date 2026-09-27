import { z } from 'zod';
import { TaskIdSchema } from '../ids';

export const BusinessSessionStorageSchema = z.object({ key: TaskIdSchema, mode: z.enum(['create', 'existing']) }).strict();
export type BusinessSessionStorage = z.infer<typeof BusinessSessionStorageSchema>;
export const BusinessStorageSchema = z.object({ version: z.literal(1), ownerTaskId: TaskIdSchema, initialize: z.boolean(), session: BusinessSessionStorageSchema.optional() }).strict();
export type BusinessStorage = z.infer<typeof BusinessStorageSchema>;
export const BUSINESS_VOLUME_DIRECTORY = 'crewstation-business-v1';
export const BUSINESS_JOURNAL_MOUNT = '/var/lib/crewstation/business-execution';
export const BUSINESS_JOURNAL_ENV = 'CS_RUNNER_BUSINESS_JOURNAL_DIR';
export const BUSINESS_SESSION_MOUNT = '/var/lib/crewstation/business-session';
export const BUSINESS_SESSION_ENV = 'CS_RUNNER_BUSINESS_SESSION_DIR';

/** 物理路径只由已验证的平台资源 ID 组成，不能接受业务请求提供的路径片段。 */
export function businessStoragePaths(ownerTaskId: string, runnerTaskId: string) {
  const owner = TaskIdSchema.parse(ownerTaskId), runner = TaskIdSchema.parse(runnerTaskId);
  const root = `${BUSINESS_VOLUME_DIRECTORY}/${owner}`;
  return { root, work: `${root}/work`, runners: `${root}/runners`, journal: `${root}/runners/${runner}`, sessions: `${root}/sessions` };
}

export function businessSessionPath(ownerTaskId: string, key: string): string {
  return `${businessStoragePaths(ownerTaskId, key).sessions}/${TaskIdSchema.parse(key)}`;
}
