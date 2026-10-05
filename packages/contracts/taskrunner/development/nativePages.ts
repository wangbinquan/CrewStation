import { z } from 'zod';
import { DevelopmentNativeStoreSchema } from './nativeSource';
import { NativeUsagePassAckSchema, NativeUsagePassPageSchema } from '../native-usage/pages';

const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
/** Original numeric rows, before the platform decides baseline membership and attribution. */
export const DevelopmentNativePageCaptureSchema = z.strictObject({
  version: z.literal(2),
  nativeSource: z.strictObject({
    version: z.literal(2), stage: z.literal('page'),
    turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    ack: NativeUsagePassAckSchema,
    sequenceFrom: sequence, sequenceThrough: sequence, sequence,
    packetIndex: z.number().int().nonnegative(), packetCount: z.number().int().positive(),
  }),
  measurements: z.array(NativeUsagePassPageSchema.shape.steps.element).max(100),
  diagnostics: z.array(z.string().min(1).max(120)).max(20),
}).superRefine((frame, ctx) => {
  const source = frame.nativeSource;
  if (source.packetIndex >= source.packetCount ||
      source.sequence !== source.sequenceFrom + source.packetIndex ||
      source.sequenceThrough !== source.sequenceFrom + source.packetCount - 1 ||
      String(source.sequenceThrough) !== source.ack.sourceWatermark) {
    ctx.addIssue({ code: 'custom', message: '原生帧必须绑定同事务持久的连续数字序列和 ACK' });
  }
});
export type DevelopmentNativePageCapture = z.infer<typeof DevelopmentNativePageCaptureSchema>;

/** Actual observer file metadata; this prepares no zero baseline or completion claim. */
export const DevelopmentNativePreparationSchema = z.strictObject({
  turn: z.string().min(1).max(512), turnIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rootSessionId: z.string().min(1).max(512), observedAt: z.iso.datetime(),
  store: DevelopmentNativeStoreSchema.options[2],
});
export type DevelopmentNativePreparation = z.infer<typeof DevelopmentNativePreparationSchema>;
