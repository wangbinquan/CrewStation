import { z } from 'zod';
import { jsonHash } from '@crewstation/kernel';
import { GitLabNativeInventorySchema, GitLabNativeInstanceSchema } from '../protocol';

const uint64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).refine(value => BigInt(value) <= 18_446_744_073_709_551_615n);
const identity = z.strictObject({ device: uint64, inode: uint64.refine(value => value !== '0') });
const identities = z.array(identity).max(100_000).refine(values => new Set(values.map(value => value.device + ':' + value.inode)).size === values.length);
const hash = z.string().regex(/^[a-f0-9]{64}$/), count = z.number().int().nonnegative();
export const GitLabActivityRequestSchema = z.strictObject({ original: GitLabNativeInventorySchema, identities });
const facts = z.strictObject({ nativeRevision: hash, identitiesDigest: hash, workhorseInFlight: count, gitalyInFlight: count,
  sidekiqInFlight: count, queuedProjectJobs: count,
  consumers: z.array(identity.extend({ pid: z.number().int().positive(), tid: z.number().int().positive(), startedTick: uint64.refine(value => value !== '0'),
    kind: z.enum(['descriptor', 'mapping', 'cwd', 'root', 'executable']) })).max(100_000),
});
export const GitLabActivityReceiptSchema = facts.extend({ version: z.literal(1), complete: z.literal(true), revision: hash,
  observedAt: z.iso.datetime({ offset: true }), runtime: GitLabNativeInventorySchema.shape.runtime,
  physicalReclamationProven: z.literal(false), producersClosed: z.literal(false), consumersStopped: z.literal(false),
}).refine(value => value.revision === jsonHash({ nativeRevision: value.nativeRevision, identitiesDigest: value.identitiesDigest,
  workhorseInFlight: value.workhorseInFlight, gitalyInFlight: value.gitalyInFlight, sidekiqInFlight: value.sidekiqInFlight,
  queuedProjectJobs: value.queuedProjectJobs, consumers: value.consumers }));
export const GitLabActivityResponseSchema = z.strictObject({ before: GitLabNativeInstanceSchema, after: GitLabNativeInstanceSchema, receipt: GitLabActivityReceiptSchema });
export type GitLabActivityRequest = z.infer<typeof GitLabActivityRequestSchema>;
export type GitLabActivityReceipt = z.infer<typeof GitLabActivityReceiptSchema>;
const source = z.strictObject({ bootId: z.uuid(), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/) });
const uid = z.string().regex(/^(?:0|[1-9][0-9]{0,9})$/).refine(value => Number(value) <= 4_294_967_295);
export const GitLabConsumerManifestSchema = z.strictObject({ version: z.literal(1), source,
  processes: z.array(z.strictObject({ pid: z.number().int().positive(), uid, startedTick: uint64.refine(value => value !== '0') })).max(10_000), revision: hash,
}).refine(value => new Set(value.processes.map(row => row.pid)).size === value.processes.length
  && value.revision === jsonHash({ source: value.source, processes: value.processes }));
export const GitLabConsumerGroupSchema = z.strictObject({ version: z.literal(1), source, originalRevision: hash, uid,
  consumers: facts.shape.consumers, identitiesDigest: hash });
