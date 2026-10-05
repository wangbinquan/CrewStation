import { createHash } from 'node:crypto';
import { z } from 'zod';
import { openBoltSnapshot } from './boltSnapshot';

const nativeId = z.string().regex(/^[a-z0-9]{20,40}$/), digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const key = z.union([nativeId, digest, z.string().regex(/^random:[a-f0-9]{64}$/)]);
const resultValue = z.strictObject({ ID: z.string().regex(/^[a-z0-9]{20,40}::[a-z0-9]{20,40}$/), CreatedAt: z.iso.datetime() });
const linkValue = z.strictObject({ Input: z.number().int().nonnegative().optional(), Output: z.number().int().nonnegative().optional(), Digest: digest, Selector: z.union([digest, z.literal('')]).optional() });
export interface BuildKitResultGraph {
  version: 'buildkit/0.33.0'; complete: true; revision: string;
  keys: string[];
  results: { key: string; workerId: string; cacheId: string; createdAt: string }[];
  links: { source: string; target: string; input: number; output: number; digest: string; selector?: string }[];
}

/** Native solver/bboltcachestorage, including both reverse indexes. Reading
 * current output layers alone would miss local inputs and shared dependencies. */
export function readBuildKitResultCache(raw: Uint8Array): BuildKitResultGraph {
  const db = openBoltSnapshot(raw), results: BuildKitResultGraph['results'] = [], links: BuildKitResultGraph['links'] = [];
  const keys = new Set<string>(), resultIndex = new Map<string, Set<string>>(), backlinks = new Map<string, Set<string>>();
  const resultBuckets = db.readBucket(['_result']), linkBuckets = db.readBucket(['_links']);
  for (const [name, row] of linkBuckets) {
    key.parse(name); if (!row.bucket) throw Error('Native BuildKit result link bucket is unsupported'); keys.add(name);
    for (const [encoded, field] of db.readBucket(['_links', name])) {
      const parts = encoded.split('@');
      if (parts.length !== 2 || field.bucket || field.value.length) throw Error('Native BuildKit result link layout is unsupported');
      const target = key.parse(parts[1]), value = linkValue.parse(JSON.parse(parts[0]!));
      links.push({ source: name, target, input: value.Input ?? 0, output: value.Output ?? 0, digest: value.Digest, ...(value.Selector ? { selector: value.Selector } : {}) });
      const parents = backlinks.get(target) ?? new Set<string>(); parents.add(name); backlinks.set(target, parents);
    }
  }
  for (const [name, row] of resultBuckets) {
    key.parse(name); if (!row.bucket || !keys.has(name)) throw Error('Native BuildKit result key is absent from the link graph');
    for (const [id, field] of db.readBucket(['_result', name])) {
      if (field.bucket) throw Error('Native BuildKit result row layout is unsupported');
      const value = resultValue.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(field.value)));
      if (value.ID !== id) throw Error('Native BuildKit result identity differs from its original key');
      const [workerId, cacheId] = value.ID.split('::');
      results.push({ key: name, workerId: nativeId.parse(workerId), cacheId: nativeId.parse(cacheId), createdAt: value.CreatedAt });
      const users = resultIndex.get(id) ?? new Set<string>(); users.add(name); resultIndex.set(id, users);
    }
  }
  verifyIndex(db, '_byresult', resultIndex); verifyIndex(db, '_backlinks', backlinks);
  if (links.some(row => !keys.has(row.target))) throw Error('Native BuildKit result dependency graph is incomplete');
  results.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))); links.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { version: 'buildkit/0.33.0', complete: true, keys: [...keys].sort(), results, links, revision: createHash('sha256').update(Buffer.from(raw)).digest('hex') };
}
function verifyIndex(db: ReturnType<typeof openBoltSnapshot>, name: string, expected: Map<string, Set<string>>) {
  const found = db.readBucket([name]);
  for (const [id, row] of found) {
    if (!row.bucket) throw Error('Native BuildKit reverse index layout is unsupported');
    const entries = db.readBucket([name, id]);
    if (!entries.size && !expected.has(id)) continue;
    const required = expected.get(id);
    if (!required || entries.size !== required.size || [...entries].some(([key, field]) => field.bucket || field.value.length || !required.has(key))) throw Error('Native BuildKit reverse index is incomplete');
  }
  if ([...expected.keys()].some(id => !found.has(id))) throw Error('Native BuildKit reverse index omitted an original dependency');
}
