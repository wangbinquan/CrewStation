import { createHash } from 'node:crypto';
import { z } from 'zod';
import { openBoltSnapshot } from '../boltSnapshot';

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/), id = z.string().regex(/^[a-z0-9]{20,40}$/);
const snapshotId = z.union([id, digest, z.string().regex(/^(?:[a-z0-9]{20,40}|sha256:[a-f0-9]{64})-view$/)]);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Bucket = ReturnType<ReturnType<typeof openBoltSnapshot>['readBucket']>;
function layout(fields: Bucket, allowed: readonly string[]) {
  if ([...fields.keys()].some(key => !allowed.includes(key))) throw Error('Native BuildKit containerd field layout is unsupported');
}
function bytes(fields: Bucket, name: string) {
  const field = fields.get(name); if (!field || field.bucket) throw Error('Native BuildKit containerd field is missing'); return field.value;
}
const text = (fields: Bucket, name: string) => new TextDecoder('utf-8', { fatal: true }).decode(bytes(fields, name));
function birth(fields: Bucket, name = 'createdat') {
  const value = bytes(fields, name); if (value.length !== 15 || value[0] !== 1) throw Error('Native BuildKit containerd birth is unsupported'); return value.toString('hex');
}
function nilKeys(fields: Bucket) {
  if ([...fields.values()].some(row => row.bucket || row.value.length)) throw Error('Native BuildKit containerd reference layout is unsupported'); return [...fields.keys()].sort();
}
function size(value: Buffer) {
  let raw = 0n;
  for (let i = 0; i < value.length && i < 10; i++) {
    const byte = value[i]!; if (i === 9 && byte > 1) break;
    raw |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) {
      const decoded = raw >> 1n;
      if (i !== value.length - 1 || i && byte === 0 || raw & 1n || decoded > BigInt(Number.MAX_SAFE_INTEGER)) break;
      return Number(decoded);
    }
  } throw Error('Native BuildKit containerd content size is invalid');
}
function labels(db: ReturnType<typeof openBoltSnapshot>, path: string[], fields: Bucket) {
  const values = fields.has('labels') ? db.readBucket([...path, 'labels']) : new Map();
  const content: string[] = [], snapshots: string[] = [], original: string[][] = [];
  for (const [key, row] of values) {
    if (row.bucket) throw Error('Native BuildKit containerd label is unsupported');
    const value = new TextDecoder('utf-8', { fatal: true }).decode(row.value); original.push([key, value]);
    if (key.startsWith('containerd.io/gc.ref.content')) content.push(digest.parse(value));
    else if (key.startsWith('containerd.io/gc.ref.snapshot.overlayfs')) snapshots.push(snapshotId.parse(value));
    else if (key.startsWith('containerd.io/gc.ref.')) throw Error('Native BuildKit containerd GC reference is unsupported');
  }
  return { identity: hash(original.sort(([a], [b]) => a!.localeCompare(b!))), content: [...new Set(content)].sort(), snapshots: [...new Set(snapshots)].sort() };
}
/** BuildKit v0.33.0 pins containerd v2.3.4. Decode both native namespaces,
 * every lease, blob and overlay reference; private labels stay one-way. */
export function readBuildKitContainerdMetadata(raw: Uint8Array) {
  const db = openBoltSnapshot(raw), top = db.readBucket([]), version = db.readBucket(['v1']);
  if (top.size !== 1 || !top.get('v1')?.bucket || bytes(version, 'version').length !== 1) throw Error('Native BuildKit containerd schema is unsupported');
  layout(version, ['version', 'buildkit', 'buildkit_history']);
  const leases: Array<{ namespace: string; kind: 'cache' | 'history' | 'other'; id: string; created: string; labelsIdentity: string; content: string[]; snapshots: string[]; ingests: number }> = [];
  const content: Array<{ namespace: string; digest: string; created: string; updated: string; size: number; labels: ReturnType<typeof labels> }> = [];
  const snapshots: Array<{ id: string; name: string; created: string; updated: string; parent?: string; children: string[]; labels: ReturnType<typeof labels> }> = [];
  let ingests = 0;
  for (const namespace of ['buildkit', 'buildkit_history']) {
    const path = ['v1', namespace], fields = db.readBucket(path); layout(fields, ['content', 'leases', ...(namespace === 'buildkit' ? ['snapshots'] : [])]);
    const objects = db.readBucket([...path, 'content']); layout(objects, ['blob', 'ingests']);
    const pending = db.readBucket([...path, 'content', 'ingests']); ingests += pending.size;
    for (const [key, row] of db.readBucket([...path, 'content', 'blob'])) {
      digest.parse(key); if (!row.bucket) throw Error('Native BuildKit containerd blob layout is unsupported');
      const original = [...path, 'content', 'blob', key], data = db.readBucket(original); layout(data, ['createdat', 'updatedat', 'size', 'labels']);
      content.push({ namespace, digest: key, created: birth(data), updated: birth(data, 'updatedat'), size: size(bytes(data, 'size')), labels: labels(db, original, data) });
    }
    for (const [key, row] of db.readBucket([...path, 'leases'])) {
      if (!row.bucket || !/^[A-Za-z0-9_.-]{1,200}$/.test(key)) throw Error('Native BuildKit containerd lease layout is unsupported');
      const original = [...path, 'leases', key], data = db.readBucket(original); layout(data, ['createdat', 'labels', 'content', 'snapshots', 'ingests']);
      const resources = data.has('content') ? nilKeys(db.readBucket([...original, 'content'])).map(value => digest.parse(value)) : [];
      const refs = data.has('snapshots') ? snapshotReferences(db, original) : [];
      const kind = id.safeParse(key).success ? 'cache' as const : /^ref_[a-z0-9]{20,40}$/.test(key) ? 'history' as const : 'other' as const;
      leases.push({ namespace, kind, id: kind === 'cache' ? key : kind === 'history' ? key.slice(4) : hash(key), created: birth(data),
        labelsIdentity: labels(db, original, data).identity, content: resources, snapshots: refs, ingests: data.has('ingests') ? db.readBucket([...original, 'ingests']).size : 0 });
    }
    if (dataBudget(content.length + leases.length + pending.size)) throw Error('Native BuildKit containerd full graph exceeded its budget');
    if (fields.has('snapshots')) snapshots.push(...overlaySnapshots(db, path));
  }
  const byId = new Map(snapshots.map(row => [row.id, row]));
  // Native metadata can retain a removed -view in its reverse index. Preserve
  // every unresolved edge: successful EOF is not ownership or absence proof.
  const unresolvedSnapshots = snapshots.flatMap(row => [
    ...(row.parent && !byId.has(row.parent) ? [{ source: row.id, target: row.parent, kind: 'parent' as const }] : []),
    ...row.children.filter(child => byId.get(child)?.parent !== row.id).map(target => ({ source: row.id, target, kind: 'child' as const })),
  ]);
  return { version: 'containerd-buildkit/v1' as const, complete: true as const, leases, content, snapshots, ingests, unresolvedSnapshots,
    revision: createHash('sha256').update(raw).digest('hex'), physicalReclamationProven: false as const };
}
const dataBudget = (count: number) => count > 100_000;
function snapshotReferences(db: ReturnType<typeof openBoltSnapshot>, original: string[]) {
  const fields = db.readBucket([...original, 'snapshots']); layout(fields, ['overlayfs']);
  return fields.has('overlayfs') ? nilKeys(db.readBucket([...original, 'snapshots', 'overlayfs'])).map(value => snapshotId.parse(value)) : [];
}
function overlaySnapshots(db: ReturnType<typeof openBoltSnapshot>, path: string[]) {
  const fields = db.readBucket([...path, 'snapshots']); layout(fields, ['overlayfs']);
  if (!fields.has('overlayfs')) return [];
  return [...db.readBucket([...path, 'snapshots', 'overlayfs'])].map(([key, row]) => {
    snapshotId.parse(key);
    if (!row.bucket) throw Error('Native BuildKit containerd snapshot layout is unsupported');
    const original = [...path, 'snapshots', 'overlayfs', key], data = db.readBucket(original); layout(data, ['name', 'createdat', 'updatedat', 'parent', 'children', 'labels']);
    const name = text(data, 'name'); if (!/^buildkit\/[1-9][0-9]*\/(?:[a-z0-9]{20,40}|sha256:[a-f0-9]{64})(?:-view)?$/.test(name)) throw Error('Native BuildKit containerd physical snapshot name is unsupported');
    return { id: key, name, created: birth(data), updated: birth(data, 'updatedat'), ...(data.has('parent') && text(data, 'parent') ? { parent: text(data, 'parent') } : {}),
      children: data.has('children') ? nilKeys(db.readBucket([...original, 'children'])).map(value => snapshotId.parse(value)) : [], labels: labels(db, original, data) };
  });
}
