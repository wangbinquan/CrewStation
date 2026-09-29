import { z } from 'zod';
import { ExecutionObservationIdentitySchema, ExecutionObservationSchema, ExecutionObservationPageFields } from './executionObservations';
import { RuntimeNativeCaptureSchema } from '../../taskrunner/nativeUsage';

export const EXECUTION_OBSERVATIONS_V2_MEDIA_TYPE = 'application/vnd.crewstation.execution-observations.v2+json';
export const ExecutionCaptureObservationSchema = z.strictObject({
  kind: z.literal('capture'), identity: ExecutionObservationIdentitySchema,
  sourceId: z.string().min(1).max(512), recordId: z.string().min(1).max(512),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  occurredAt: z.null(), observedAt: z.iso.datetime(), capture: RuntimeNativeCaptureSchema,
}).superRefine((value, ctx) => {
  if (JSON.stringify(value.identity) !== JSON.stringify(value.capture.identity) || value.sourceId !== value.capture.sourceId ||
    value.recordId !== value.capture.id || value.observedAt !== value.capture.proof.observedAt)
    ctx.addIssue({ code: 'custom', message: '采集摘要与观测信封不一致' });
});
export const ExecutionObservationV2Schema = z.union([ExecutionObservationSchema, ExecutionCaptureObservationSchema]);
const page = { ...ExecutionObservationPageFields, schemaVersion: z.literal(2), capability: z.literal('executionObservationsV2'),
  items: z.array(ExecutionObservationV2Schema).max(500) };
const key = z.string().min(1).max(512);
export const ExecutionObservationV2PageSchema = z.discriminatedUnion('mode', [
  z.strictObject({ ...page, mode: z.literal('incremental') }),
  z.strictObject({ ...page, mode: z.literal('snapshot'), snapshotId: key, snapshotThrough: key, expiresAt: z.iso.datetime() }),
]).superRefine((value, ctx) => {
  for (const [index, item] of value.items.entries()) {
    if (item.identity.taskId !== value.taskId || item.identity.projectId !== value.projectId)
      ctx.addIssue({ code: 'custom', path: ['items', index, 'identity'], message: '观测项与页面身份不一致' });
    if (value.costVisibility === 'hidden' && item.kind === 'valuation' && item.availability === 'priced')
      ctx.addIssue({ code: 'custom', path: ['items', index], message: '隐藏金额页面不能包含估值' });
  }
  if (value.mode === 'snapshot' && value.snapshotThrough !== value.persistedThrough)
    ctx.addIssue({ code: 'custom', path: ['snapshotThrough'], message: '快照水位不一致' });
});
export type ExecutionCaptureObservation = z.infer<typeof ExecutionCaptureObservationSchema>;
export type ExecutionObservationV2 = z.infer<typeof ExecutionObservationV2Schema>;
export type ExecutionObservationV2Page = z.infer<typeof ExecutionObservationV2PageSchema>;
