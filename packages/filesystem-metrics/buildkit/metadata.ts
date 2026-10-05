import { createHash } from 'node:crypto';
import { z } from 'zod';
import { openBoltSnapshot } from './boltSnapshot';

const id = z.string().regex(/^[a-z0-9]{20,40}$/), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const BuildKitCacheRecordSchema = z.strictObject({
  id, snapshot: z.union([id, digest]), createdNanoseconds: z.string().regex(/^[1-9][0-9]{0,24}$/),
  recordType: z.enum(['regular', 'source.local', 'source.git.checkout', 'exec.cachemount', 'frontend', 'internal']),
  parents: z.array(id), equalMutable: id.optional(), diffId: digest.optional(), chainId: digest.optional(), blobChainId: digest.optional(), blob: digest.optional(),
  lastUsedNanoseconds: z.string().regex(/^[1-9][0-9]{0,24}$/).optional(),
  local: z.strictObject({ name: z.string().regex(/^[a-zA-Z0-9_.-]{1,128}$/), sharedKeyIdentity: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
});
export type BuildKitCacheRecord = z.infer<typeof BuildKitCacheRecordSchema>;
/** v0.33.0 cache/metadata.go and cache/metadata/metadata.go.
 * Decode only native identities. Descriptions, commands, URLs, content hashes
 * and arbitrary external metadata never leave this reader. */
export function readBuildKitCacheMetadata(raw: Uint8Array) {
  const database = openBoltSnapshot(raw), records: BuildKitCacheRecord[] = [], all = database.readBucket(['_main']);
  if (all.size > 100_000) throw Error('Native BuildKit cache record budget exceeded');
  const valueSchema = z.strictObject({ value: z.json(), index: z.string().optional() }), decoder = new TextDecoder('utf-8', { fatal: true });
  for (const [key, entry] of all) {
    if (!entry.bucket || !id.safeParse(key).success) throw Error('Native BuildKit cache record layout is unsupported');
    const fields = database.readBucket(['_main', key]);
    const read = (name: string): unknown => {
      const field = fields.get(name);
      if (!field) return undefined;
      if (field.bucket) throw Error('Native BuildKit cache field layout is unsupported');
      // Native StorageItem omits nil tombstones when loading a value.
      if (!field.value.length) return undefined;
      return valueSchema.parse(JSON.parse(decoder.decode(field.value))).value;
    };
    const parent = read('cache.parent'), merges = read('cache.mergeParents'), lower = read('cache.lowerDiffParent'), upper = read('cache.upperDiffParent');
    if (merges !== undefined && !z.array(id).safeParse(merges).success) throw Error('Native BuildKit merge parents are invalid');
    const parents = [parent, ...(merges as string[] | undefined ?? []), lower, upper].filter(value => value !== undefined && value !== '');
    if (parents.some(value => !id.safeParse(value).success)) throw Error('Native BuildKit parent identity is invalid');
    const created = fields.get('cache.createdAt');
    // Go stores Unix nanoseconds as a JSON integer. Preserve all digits; a JS
    // floating point round-trip would conflate different original births.
    const nanoseconds = created && !created.bucket ? /^\{\s*"value"\s*:\s*([1-9][0-9]{0,24})\s*(?:,"index"\s*:\s*"[^"\\]*"\s*)?\}$/.exec(decoder.decode(created.value))?.[1] : undefined;
    if (!nanoseconds) throw Error('Native BuildKit cache birth is missing');
    const used = fields.get('cache.lastUsedAt');
    const lastUsedNanoseconds = used && !used.bucket && used.value.length ? /^\{\s*"value"\s*:\s*([1-9][0-9]{0,24})\s*(?:,"index"\s*:\s*"[^"\\]*"\s*)?\}$/.exec(decoder.decode(used.value))?.[1] : undefined;
    if (used?.value.length && !lastUsedNanoseconds && read('cache.lastUsedAt') !== null) throw Error('Native BuildKit last-use identity is unsupported');
    const localKey = read('local.sharedKey');
    if (localKey !== undefined && (typeof localKey !== 'string' || !/^[a-zA-Z0-9_.-]{1,128}:/.test(localKey))) throw Error('Native BuildKit local input identity is unsupported');
    const fieldsToRead = { equalMutable: 'cache.equalMutable', diffId: 'cache.diffID', chainId: 'cache.chainID', blobChainId: 'cache.blobChainID', blob: 'cache.blob' };
    const optional = Object.fromEntries(Object.entries(fieldsToRead).flatMap(([field, native]) => {
      const value = read(native); return value === undefined || value === '' ? [] : [[field, value]];
    }));
    const snapshot = read('cache.snapshot');
    records.push(BuildKitCacheRecordSchema.parse({ id: key, snapshot: snapshot === undefined || snapshot === '' ? key : snapshot,
      createdNanoseconds: nanoseconds, recordType: read('cache.recordType') || 'regular', parents: [...new Set(parents)], ...optional,
      ...(lastUsedNanoseconds ? { lastUsedNanoseconds } : {}), ...(typeof localKey === 'string' ? { local: { name: localKey.split(':')[0]!, sharedKeyIdentity: createHash('sha256').update(localKey).digest('hex') } } : {}) }));
  }
  const ids = new Set(records.map(row => row.id));
  for (const row of records) if (row.parents.some(parent => !ids.has(parent)) || row.equalMutable && !ids.has(row.equalMutable)) throw Error('Native BuildKit cache parent graph is incomplete');
  records.sort((a, b) => a.id.localeCompare(b.id));
  return { version: 'buildkit/0.33.0' as const, complete: true as const, records,
    revision: createHash('sha256').update(Buffer.from(raw)).digest('hex'),
    graphIdentity: createHash('sha256').update(JSON.stringify(records)).digest('hex') };
}
