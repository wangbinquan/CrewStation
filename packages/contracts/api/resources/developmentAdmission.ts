import { z } from 'zod';
import { WorkloadConsumerSchema, WorkloadStartPermitSchema } from './workloadSafety';

/** Private selection on a newly admitted independent development Agent; never a legacy upgrade. */
export const DevelopmentRemovalProtectionSchema = z.strictObject({ version: z.literal(1) });
export type DevelopmentRemovalProtection = z.infer<typeof DevelopmentRemovalProtectionSchema>;
export const DevelopmentAdmissionStateSchema = z.strictObject({ version: z.literal(1), intentHash: z.string().regex(/^[0-9a-f]{64}$/), secretUid: z.uuid().nullable() });
export type DevelopmentAdmissionState = z.infer<typeof DevelopmentAdmissionStateSchema>;
/** Only the trusted original Kubernetes creator supplies a receipt; this is not a public command. */
export const DevelopmentAdmissionReceiptSchema = z.strictObject({
  version: z.literal(1), consumer: WorkloadConsumerSchema, permit: WorkloadStartPermitSchema.omit({ grantedAt: true }),
  intentHash: z.string().regex(/^[0-9a-f]{64}$/), secretUid: z.uuid(),
}).refine((r) => r.consumer.purpose === 'agent' && r.consumer.finalization === null && r.consumer.resourceId !== r.consumer.taskId, '原准入回执仅属于独立开发 Agent');
export type DevelopmentAdmissionReceipt = z.infer<typeof DevelopmentAdmissionReceiptSchema>;
