import { z } from 'zod';

const uint64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/).refine((value) => /^[0-9]{1,20}$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n);
const fileIdentity = z.object({ device: uint64, inode: uint64.refine((value) => value !== '0') }).strict();
const identities = z.array(fileIdentity).max(256).refine((values) => new Set(values.map(({ device, inode }) => `${device}:${inode}`)).size === values.length);
const source = z.object({ bootId: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/), namespace: z.string().regex(/^pid:\[[1-9][0-9]*\]$/).max(80) }).strict();

/** Capture records the actual visible namespace; every later observation binds that original source. */
export const ConsumerRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('capture'), identities }).strict(),
  z.object({ mode: z.literal('observe'), source, identities }).strict(),
]);
export const ConsumerResponseSchema = z.object({
  version: z.literal(1), complete: z.boolean(), bootId: z.string().max(128), namespace: z.string().max(128),
  consumers: z.array(z.object({
    pid: z.number().int().positive(), tid: z.number().int().positive(), startedTick: uint64,
    kind: z.enum(['descriptor', 'mapping', 'cwd', 'root', 'executable']), device: uint64, inode: uint64.refine((value) => value !== '0'),
  }).strict()),
  blockers: z.array(z.object({ code: z.enum(['source-unreadable', 'source-changed', 'process-unreadable', 'process-changed']), pid: z.number().int().positive().optional() }).strict()),
}).strict().refine((value) => !value.complete || (value.blockers.length === 0
  && source.safeParse({ bootId: value.bootId, namespace: value.namespace }).success), 'Complete consumer evidence requires a valid source and no blockers');

export type ConsumerRequest = z.infer<typeof ConsumerRequestSchema>;
export type ConsumerResponse = z.infer<typeof ConsumerResponseSchema>;
