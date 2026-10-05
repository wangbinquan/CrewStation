import { z } from 'zod';
import { protoBoolean, protoBytes, protoFields, protoInteger, protoText, protoTimestamp } from './protobuf';
import { buildKitHistoryIdentity } from './historyIdentity';

const id = z.string().regex(/^[a-z0-9]{20,40}$/), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const BuildKitUsageSchema = z.strictObject({ id, mutable: z.boolean(), inUse: z.boolean(), size: z.number().int().nonnegative(),
  createdAt: z.iso.datetime({ precision: 9 }), lastUsedAt: z.iso.datetime({ precision: 9 }).optional(), usageCount: z.number().int().nonnegative(),
  recordType: z.enum(['regular', 'source.local', 'source.git.checkout', 'exec.cachemount', 'frontend', 'internal']), shared: z.boolean(), parents: z.array(id) });
export type BuildKitUsage = z.infer<typeof BuildKitUsageSchema>;
export function buildKitVersion(raw: Uint8Array) {
  const fields = protoFields(raw);
  const version = protoText(fields, 2, true), revision = protoText(fields, 3, true), packageName = protoText(fields, 1, true);
  if (version !== 'v0.33.0' || packageName !== 'github.com/moby/buildkit' || !/^[a-f0-9]{40}$/.test(revision ?? '')) throw Error('Original native BuildKit version is unsupported');
  return { version, revision, package: packageName };
}
export function buildKitUsage(raw: Uint8Array): BuildKitUsage {
  const fields = protoFields(raw), parents = fields.filter(row => row.number === 12);
  if (parents.some(row => row.wire !== 2)) throw Error('Original native BuildKit parent wire type is invalid');
  const legacy = protoText(fields, 5), current = parents.map(row => new TextDecoder('utf-8', { fatal: true }).decode(row.value as Uint8Array));
  return BuildKitUsageSchema.parse({ id: protoText(fields, 1, true), mutable: protoBoolean(fields, 2), inUse: protoBoolean(fields, 3),
    size: protoInteger(fields, 4), createdAt: protoTimestamp(protoBytes(fields, 6, true)), lastUsedAt: protoTimestamp(protoBytes(fields, 7)),
    usageCount: protoInteger(fields, 8), recordType: protoText(fields, 10) || 'regular', shared: protoBoolean(fields, 11),
    parents: [...new Set([...current, ...(legacy ? [legacy] : [])])].sort() });
}
function descriptor(raw: Uint8Array) {
  const fields = protoFields(raw);
  return z.strictObject({ digest, size: z.number().int().nonnegative(), mediaType: z.string().min(1) }).parse({
    digest: protoText(fields, 2, true), size: protoInteger(fields, 3), mediaType: protoText(fields, 1, true) });
}
function resultDescriptors(raw: Uint8Array): ReturnType<typeof descriptor>[] {
  const fields = protoFields(raw), values: ReturnType<typeof descriptor>[] = [];
  const original = protoBytes(fields, 1); if (original) values.push(descriptor(original));
  for (const row of fields.filter(row => row.number === 2 || row.number === 3)) {
    if (row.wire !== 2) throw Error('Original native BuildKit result wire type is invalid');
    if (row.number === 2) values.push(descriptor(row.value as Uint8Array));
    else {
      const entry = protoFields(row.value as Uint8Array); protoInteger(entry, 1);
      values.push(descriptor(protoBytes(entry, 2, true)!));
    }
  }
  return values;
}
export const BuildKitHistorySchema = z.strictObject({ ref: id, event: z.enum(['started', 'complete', 'deleted']), createdAt: z.iso.datetime({ precision: 9 }),
  completedAt: z.iso.datetime({ precision: 9 }).optional(), pinned: z.boolean(), generation: z.number().int().nonnegative(), failed: z.boolean(),
  descriptors: z.array(z.strictObject({ digest, size: z.number().int().nonnegative(), mediaType: z.string().min(1) })), nativeIdentity: z.string().regex(/^[a-f0-9]{64}$/) });
export type BuildKitHistory = z.infer<typeof BuildKitHistorySchema>;
/** Keep only native identities. Raw frontend/exporter maps, logs and errors are
 * never returned; their original bytes remain bound by the one-way digest. */
export function buildKitHistory(raw: Uint8Array): BuildKitHistory {
  const fields = protoFields(raw), event = protoInteger(fields, 1), record = protoBytes(fields, 2, true)!, body = protoFields(record);
  if (event > 2) throw Error('Original native BuildKit history event is unsupported');
  const descriptors: ReturnType<typeof descriptor>[] = [];
  for (const number of [8, 13, 18]) { const value = protoBytes(body, number); if (value) descriptors.push(descriptor(value)); }
  const result = protoBytes(body, 10); if (result) descriptors.push(...resultDescriptors(result));
  for (const row of body.filter(row => row.number === 11)) {
    if (row.wire !== 2) throw Error('Original native BuildKit history result wire type is invalid');
    const entry = protoFields(row.value as Uint8Array); protoText(entry, 1, true);
    descriptors.push(...resultDescriptors(protoBytes(entry, 2, true)!));
  }
  const completedAt = protoTimestamp(protoBytes(body, 7));
  if (event === 1 && !completedAt) throw Error('Completed native BuildKit history is missing its actual terminal birth');
  return BuildKitHistorySchema.parse({ ref: protoText(body, 1, true), event: ['started', 'complete', 'deleted'][event],
    createdAt: protoTimestamp(protoBytes(body, 6, true)), completedAt, pinned: protoBoolean(body, 14), generation: protoInteger(body, 12),
    failed: protoBytes(body, 5) !== undefined || protoBytes(body, 18) !== undefined,
    descriptors: [...new Map(descriptors.map(row => [row.digest, row])).values()].sort((a, b) => a.digest.localeCompare(b.digest)),
    nativeIdentity: buildKitHistoryIdentity(record) });
}
