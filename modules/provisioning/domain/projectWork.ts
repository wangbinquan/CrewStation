import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const ProvisioningContainerProcessSchema = z.object({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),
  nodeUid: z.uuid(), nodeName: z.string().min(1).max(253) }).strict();
export const ProvisioningPodProcessSchema = ProvisioningContainerProcessSchema.omit({ containerId: true });
export const ProvisioningCallbackProcessSchema = ProvisioningContainerProcessSchema.extend({ pid: z.number().int().positive(),
  pidNamespace: z.string().regex(/^[0-9]+$/), bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) }).strict();
export const ProvisioningCallbackSchema = z.object({ id: ResourceIdSchema, projectId: ProjectIdSchema, serviceId: ResourceIdSchema,
  kind: z.enum(['provision', 'enqueue', 'namespace-reapply']), consumerId: ResourceIdSchema, inputDigest: hash,
  backendPid: z.number().int().positive(), process: ProvisioningCallbackProcessSchema, exitKeyDigest: hash,
  exited: z.boolean(), exitDigest: hash.nullable(), recoveryDigest: hash.nullable(),
}).strict().superRefine((record, context) => {
  if (record.exited !== !!record.exitDigest || record.recoveryDigest && !record.exited
    || record.exited && record.exitDigest !== provisioningCallbackIdentity(record, record.recoveryDigest ?? undefined))
    context.addIssue({ code: 'custom', message: '开通原回调退出事实不完整' });
});
export type ProvisioningContainerProcess = z.infer<typeof ProvisioningContainerProcessSchema>;
export type ProvisioningPodProcess = z.infer<typeof ProvisioningPodProcessSchema>;
export type ProvisioningCallbackProcess = z.infer<typeof ProvisioningCallbackProcessSchema>;
export type ProvisioningCallback = z.infer<typeof ProvisioningCallbackSchema>;
export type ProvisioningWorkKind = ProvisioningCallback['kind'];
export function provisioningCallbackIdentity(record: ProvisioningCallback, recoveryDigest?: string): string {
  const { exited: _exited, exitDigest: _exit, recoveryDigest: _recovery, ...birth } = record;
  return jsonHash({ ...birth, ...(recoveryDigest ? { recoveryDigest } : {}) });
}
export function provisioningContainer(process: ProvisioningCallbackProcess): ProvisioningContainerProcess {
  const { podUid, containerId, nodeUid, nodeName } = process;
  return { podUid, containerId, nodeUid, nodeName };
}
