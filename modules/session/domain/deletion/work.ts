import { ProjectIdSchema, ResourceIdSchema, TaskIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';
import { SessionProcessSchema } from './process';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const SessionWorkGrantSchema = z.strictObject({ operationId: ResourceIdSchema, generation: z.number().int().positive(),
  phase: z.literal('stop'), revision: digest });
export const SessionWorkInputSchema = z.strictObject({ taskKey: z.string().min(1), kind: z.enum(['command', 'cleanup']),
  reference: z.string().min(1), inputDigest: digest });
export const SessionWorkBirthSchema = z.strictObject({ id: ResourceIdSchema, projectId: ProjectIdSchema.nullable(),
  taskKey: z.string().min(1), taskId: TaskIdSchema, originRevision: digest, kind: z.enum(['command', 'cleanup']),
  reference: z.string().min(1), inputDigest: digest, backendPid: z.number().int().positive().max(2147483647),
  process: SessionProcessSchema.nullable(), grant: SessionWorkGrantSchema.nullable(), exitKeyDigest: digest });
export type SessionWorkBirth = z.infer<typeof SessionWorkBirthSchema>;
export type SessionWorkInput = z.infer<typeof SessionWorkInputSchema>;
export type SessionWorkGrant = z.infer<typeof SessionWorkGrantSchema>;

/** Private keys and command payloads stay out of the persisted birth and public evidence. */
export const sessionWorkIdentity = (birth: SessionWorkBirth) => jsonHash(SessionWorkBirthSchema.parse(birth));
export const sessionWorkExitIdentity = (birth: SessionWorkBirth, recoveryDigest: string | null) => recoveryDigest === null
  ? sessionWorkIdentity(birth) : jsonHash({ ...SessionWorkBirthSchema.parse(birth), recoveryDigest: digest.parse(recoveryDigest) });
export const SessionWorkCallbackSchema = SessionWorkBirthSchema.extend({ identity: digest, exited: z.boolean(),
  exitDigest: digest.nullable(), recoveryDigest: digest.nullable() }).superRefine((callback, context) => {
  const { identity, exited, exitDigest, recoveryDigest, ...birth } = callback;
  if (identity !== sessionWorkIdentity(birth)) context.addIssue({ code: 'custom', message: 'Session 原命令出生摘要不符' });
  if (exited !== (exitDigest !== null) || !exited && recoveryDigest !== null
    || exited && exitDigest !== sessionWorkExitIdentity(birth, recoveryDigest)) context.addIssue({ code: 'custom', message: 'Session 原命令缺少私有 finally 或原 Pod 停止证明' });
  if ((birth.kind === 'cleanup') !== (birth.grant !== null) || birth.grant && birth.projectId === null)
    context.addIssue({ code: 'custom', message: 'Session 清理回调与原项目停止许可不符' });
});
export type SessionWorkCallback = z.infer<typeof SessionWorkCallbackSchema>;
