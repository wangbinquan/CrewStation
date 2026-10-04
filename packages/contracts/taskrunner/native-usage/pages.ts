import { z } from 'zod'
import { ExecutionObservationUsageSchema } from '../../api/observability/executionObservations'

const key = z.string().min(1).max(512)
// Total population and positions are arbitrary-precision decimals, never a packet-size budget.
const decimalPattern = /^(0|[1-9]\d*)$/
const count = z.string().regex(decimalPattern)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const cursor = z.string().min(1)
export const NativeUsagePassCountsSchema = z.object({
  sessions: count, parts: count, steps: count,
}).strict()
export const NativeUsagePassIdentitySchema = z.object({
  passId: key, turn: key, nativeSource: key, sourceGeneration: key,
  rootSessionId: key, lineageKey: key, epoch: key, phase: z.enum(['baseline', 'final']),
}).strict()
const session = z.object({ id: key, parentSessionId: key.nullable() }).strict()
const step = session.extend({
  stepId: key, occurredAt: z.number().int().nonnegative().max(253402300800000).nullable(),
  usage: ExecutionObservationUsageSchema,
  model: z.object({ provider: z.string().min(1).max(200), id: z.string().min(1).max(300) }).strict().nullable(),
})
const eof = z.object({ fingerprint: digest, counts: NativeUsagePassCountsSchema }).strict()
/** Only one bounded transport page is retained. The full pass has no row/page/depth cap. */
export const NativeUsagePassPageSchema = z.object({
  identity: NativeUsagePassIdentitySchema, ordinal: count, cursor, nextCursor: cursor.nullable(),
  previousDigest: digest, payloadDigest: digest, cumulativeDigest: digest,
  scanPositionBefore: count, scanPositionAfter: count, scannedRawRows: count,
  counts: NativeUsagePassCountsSchema,
  sessions: z.array(session).max(1000), steps: z.array(step).max(1000),
  issues: z.array(z.string().min(1).max(200)).max(100), eof: eof.nullable(),
}).strict().superRefine((page, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (![page.scanPositionBefore, page.scanPositionAfter, page.scannedRawRows,
      ...Object.values(page.counts)].every((value) => decimalPattern.test(value))) return
  const before = BigInt(page.scanPositionBefore), after = BigInt(page.scanPositionAfter)
  const scanned = BigInt(page.scannedRawRows)
  if (after < before || after - before !== scanned || scanned > 1000n)
    invalid('Native page must retain its exact scan progress')
  if (page.sessions.length + page.steps.length > 1000 ||
      BigInt(page.sessions.length + page.steps.length) > scanned)
    invalid('Native records must fit one transport packet')
  if ((page.eof === null) !== (page.nextCursor !== null) ||
      (page.eof === null && (scanned === 0n || page.nextCursor === page.cursor)))
    invalid('Only original EOF may end a pass; other pages must advance')
  if (page.eof && JSON.stringify(page.eof.counts) !== JSON.stringify(page.counts))
    invalid('Native EOF must retain the exact cumulative population')
  if (new Set(page.sessions.map((row) => row.id)).size !== page.sessions.length ||
      new Set(page.steps.map((row) => row.stepId)).size !== page.steps.length)
    invalid('Native page contains duplicate original identities')
  if (BigInt(page.counts.sessions) < BigInt(page.sessions.length) ||
      BigInt(page.counts.steps) < BigInt(page.steps.length) ||
      BigInt(page.counts.parts) < BigInt(page.counts.steps))
    invalid('Native cumulative counts cannot omit a returned record')
  for (const row of [...page.sessions, ...page.steps]) {
    if ((row.id === page.identity.rootSessionId) !== (row.parentSessionId === null) ||
        row.parentSessionId === row.id)
      invalid('Native parent reference must retain the original root and child relation')
  }
})
/** Issued after the original owner transaction commits. It is not a projection acknowledgement. */
export const NativeUsagePassAdmissionSchema = z.object({
  identity: NativeUsagePassIdentitySchema, initialCursor: cursor,
  ownerReceiptId: key, sourceWatermark: count,
}).strict()
export const NativeUsagePassAckSchema = z.object({
  contract: z.literal('native-usage-page-ack-v2'), identity: NativeUsagePassIdentitySchema,
  ownerReceiptId: key, ordinal: count, payloadDigest: digest, cumulativeDigest: digest,
  scanPositionAfter: count, counts: NativeUsagePassCountsSchema,
  nextCursor: cursor.nullable(), sourceWatermark: count, eof: eof.nullable(),
}).strict().superRefine((ack, ctx) => {
  if ((ack.eof === null) !== (ack.nextCursor !== null) ||
      (ack.eof && JSON.stringify(ack.eof.counts) !== JSON.stringify(ack.counts)))
    ctx.addIssue({ code: 'custom', message: 'Native owner ACK must retain original EOF and counts' })
})
export type NativeUsagePassIdentity = z.infer<typeof NativeUsagePassIdentitySchema>
export type NativeUsagePassPage = z.infer<typeof NativeUsagePassPageSchema>
export type NativeUsagePassAdmission = z.infer<typeof NativeUsagePassAdmissionSchema>
export type NativeUsagePassAck = z.infer<typeof NativeUsagePassAckSchema>
