import { z } from 'zod';
import { DevelopmentNativePreparationSchema } from './nativePages';
import { NativeUsagePassAckSchema, NativeUsagePassAdmissionSchema, NativeUsagePassPageSchema } from '../native-usage/pages';

/** One transport chunk; neither an original page nor the whole population has a byte cutoff. */
export const DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES = 64 * 1024;
const position = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const metadata = z.strictObject({
  version: z.literal(2), podUid: z.string().min(1).max(128),
  preparation: DevelopmentNativePreparationSchema, baselineKind: z.enum(['fresh', 'resume']),
  admission: NativeUsagePassAdmissionSchema,
  rootCreatedAt: z.number().int().nonnegative().max(253402300799999).nullable(),
  ack: NativeUsagePassAckSchema,
});
function originalMetadata(value: z.infer<typeof metadata>, ctx: z.RefinementCtx): void {
  const { ack, admission, preparation } = value;
  if (Object.entries(ack.identity).some(([key, item]) => admission.identity[key as keyof typeof admission.identity] !== item) ||
      ack.ownerReceiptId !== admission.ownerReceiptId || ack.identity.turn !== preparation.turn ||
      ack.identity.rootSessionId !== preparation.rootSessionId || ack.identity.epoch !== preparation.store.sourceEpoch ||
      ack.identity.nativeSource !== 'opencode:' + preparation.store.actualPathDigest ||
      (value.baselineKind === 'fresh' && ack.identity.phase === 'baseline'))
    ctx.addIssue({ code: 'custom', message: '原页传输必须保留原准入、ACK与准备的同一身份' });
}
export const DevelopmentNativePageChunkBodySchema = metadata.extend({
  document: z.strictObject({
    digest: z.string().regex(/^[a-f0-9]{64}$/), afterByte: position, throughByte: position,
    totalBytes: position.refine((value) => value > 0),
    chunk: z.string().regex(base64).max(Math.ceil(DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES / 3) * 4),
    eof: z.boolean(),
  }),
}).superRefine((value, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  originalMetadata(value, ctx);
  const { document } = value;
  let bytes: string;
  try { bytes = atob(document.chunk); } catch { invalid('原页传输块必须保留原字节'); return; }
  if (btoa(bytes) !== document.chunk || bytes.length > DEVELOPMENT_NATIVE_PAGE_CHUNK_BYTES ||
      document.throughByte !== document.afterByte + bytes.length || document.throughByte > document.totalBytes ||
      document.eof !== (document.throughByte === document.totalBytes) || (!document.eof && bytes.length === 0))
    invalid('原页字节范围必须连续，只有实际字节末尾才能结束');

});

/** An assembled original page, copied durably as evidence; this is not a second numeric ledger. */
export const DevelopmentNativePageEvidenceBodySchema = metadata.extend({ document: z.string().min(1) }).superRefine((value, ctx) => {
  originalMetadata(value, ctx);
  const invalid = () => ctx.addIssue({ code: 'custom', message: '原页文档必须与冻结ACK保持相同身份、范围和原EOF' });
  let raw: unknown;
  try { raw = JSON.parse(value.document); } catch { invalid(); return; }
  const result = NativeUsagePassPageSchema.safeParse(raw);
  if (!result.success) { invalid(); return; }
  const page = result.data, ack = value.ack;
  if (Object.entries(page.identity).some(([key, item]) => ack.identity[key as keyof typeof ack.identity] !== item) ||
      page.ordinal !== ack.ordinal || page.payloadDigest !== ack.payloadDigest || page.cumulativeDigest !== ack.cumulativeDigest ||
      page.scanPositionAfter !== ack.scanPositionAfter || page.nextCursor !== ack.nextCursor ||
      Object.entries(page.counts).some(([key, item]) => ack.counts[key as keyof typeof ack.counts] !== item) ||
      JSON.stringify(page.eof) !== JSON.stringify(ack.eof)) invalid();
});
