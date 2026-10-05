import { expect, test } from 'bun:test';
import { boltSnapshotFixture } from '../fixture';
import type { BoltFixtureField } from '../fixture';
import { readBuildKitContainerdMetadata } from './containerd';

const own = 'a'.repeat(25), foreign = 'b'.repeat(25), digest = 'sha256:' + 'c'.repeat(64);
const created = Buffer.from('010000000ee24f294d1038f2cbffff', 'hex'), empty = Buffer.alloc(0);
const field = (key: string, value: Buffer | readonly BoltFixtureField[]) => ({ key, value });
const label = (key: string, value: string) => field(key, Buffer.from(value));
function fixture(): BoltFixtureField[] {
  const blob = [field('createdat', created), field('updatedat', created), field('size', Buffer.from([24])), field('labels', [label('private', 'secret-token')])];
  const lease = [field('createdat', created), field('content', [field(digest, empty)]), field('snapshots', [field('overlayfs', [field(own, empty)])])];
  const snapshot = [field('name', Buffer.from('buildkit/196/' + own)), field('createdat', created), field('updatedat', created), field('children', [])];
  const content = [field('blob', [field(digest, blob)]), field('ingests', [])];
  const buildkit = [field('content', content), field('leases', [field(own, lease), field('original-native-lease', [field('createdat', created)])]),
    field('snapshots', [field('overlayfs', [field(own, snapshot)])])];
  const historyLease = field('ref_' + foreign, [field('createdat', created), field('content', [field(digest, empty)])]);
  const history = [field('content', content), field('leases', [historyLease])];
  return [field('v1', [field('version', Buffer.from([5])), field('buildkit', buildkit), field('buildkit_history', history)])];
}
const fields = (rows: BoltFixtureField[], key: string) => rows.find(row => row.key === key)!.value as BoltFixtureField[];
test('full native containerd graph retains both namespaces, original births, cache and history leases, all content and physical names', () => {
  const result = readBuildKitContainerdMetadata(boltSnapshotFixture(fixture()));
  expect(result).toMatchObject({ complete: true, version: 'containerd-buildkit/v1', ingests: 0, physicalReclamationProven: false });
  expect(result.leases).toHaveLength(3); expect(result.content).toHaveLength(2); expect(result.snapshots).toHaveLength(1);
  expect(result.leases[0]).toMatchObject({ namespace: 'buildkit', kind: 'cache', id: own, created: created.toString('hex'), content: [digest], snapshots: [own] });
  expect(result.leases.find(row => row.kind === 'history')).toMatchObject({ namespace: 'buildkit_history', id: foreign, content: [digest] });
  expect(result.leases.find(row => row.kind === 'other')?.id).toMatch(/^[a-f0-9]{64}$/);
  expect(result.snapshots[0]).toMatchObject({ id: own, name: 'buildkit/196/' + own, created: created.toString('hex') });
  expect(result.content[0]).toMatchObject({ digest, size: 12 }); expect(JSON.stringify(result)).not.toContain('secret-token'); expect(JSON.stringify(result)).not.toContain('original-native-lease');
});
test('native GC content references are decoded while private labels remain one-way and replacement changes their identity', () => {
  const raw = fixture(), namespace = fields(fields(raw, 'v1'), 'buildkit'), blob = fields(fields(fields(namespace, 'content'), 'blob'), digest);
  fields(blob, 'labels').push(label('containerd.io/gc.ref.content.0', digest));
  const before = readBuildKitContainerdMetadata(boltSnapshotFixture(raw));
  expect(before.content[0]?.labels.content).toEqual([digest]);
  fields(blob, 'labels')[0]!.value = Buffer.from('changed-original-label');
  const after = readBuildKitContainerdMetadata(boltSnapshotFixture(raw));
  expect(after.content[0]?.labels.identity).not.toBe(before.content[0]?.labels.identity);
  expect(JSON.stringify(after)).not.toContain('changed-original-label');
});
test('unknown namespaces, fields, GC reference types and invalid original births cannot become an empty native graph', () => {
  const missing = fixture(); fields(missing, 'v1').pop(); expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(missing))).toThrow('not found');
  const unknown = fixture(); fields(unknown, 'v1').push(field('foreign', [])); expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(unknown))).toThrow('unsupported');
  const privateField = fixture(); fields(fields(privateField, 'v1'), 'buildkit').push(field('unknown', empty)); expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(privateField))).toThrow('unsupported');
  const birth = fixture(); fields(fields(fields(fields(birth, 'v1'), 'buildkit'), 'leases'), own)[0]!.value = Buffer.alloc(14); expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(birth))).toThrow('birth');
  const gc = fixture(); fields(fields(fields(fields(fields(gc, 'v1'), 'buildkit'), 'content'), 'blob'), digest).push(field('unexpected', empty)); expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(gc))).toThrow('unsupported');
});
test('malformed sizes and populated lease references fail; native unresolved parent or view edges remain explicit', () => {
  for (const value of [[25], [128], [152, 0], [24, 0], Array(10).fill(255)]) {
    const raw = fixture(), blob = fields(fields(fields(fields(raw, 'v1'), 'buildkit'), 'content'), 'blob');
    fields(blob, digest).find(row => row.key === 'size')!.value = Buffer.from(value);
    expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(raw))).toThrow('size');
  }
  const refs = fixture(); fields(fields(fields(fields(fields(refs, 'v1'), 'buildkit'), 'leases'), own), 'content')[0]!.value = Buffer.from([1]);
  expect(() => readBuildKitContainerdMetadata(boltSnapshotFixture(refs))).toThrow('reference');
  const parent = fixture(); fields(fields(fields(fields(fields(parent, 'v1'), 'buildkit'), 'snapshots'), 'overlayfs'), own).push(field('parent', Buffer.from(foreign)));
  expect(readBuildKitContainerdMetadata(boltSnapshotFixture(parent)).unresolvedSnapshots).toEqual([{ source: own, target: foreign, kind: 'parent' }]);
  const view = fixture(); fields(fields(fields(fields(fields(fields(view, 'v1'), 'buildkit'), 'snapshots'), 'overlayfs'), own), 'children').push(field(own + '-view', empty));
  expect(readBuildKitContainerdMetadata(boltSnapshotFixture(view)).unresolvedSnapshots).toEqual([{ source: own, target: own + '-view', kind: 'child' }]);
  expect(readBuildKitContainerdMetadata(boltSnapshotFixture(view)).physicalReclamationProven).toBe(false);
  const nativeChildren = fields(fields(fields(fields(fields(fields(view, 'v1'), 'buildkit'), 'snapshots'), 'overlayfs'), own), 'children');
  nativeChildren.push(field(digest + '-view', empty));
  expect(readBuildKitContainerdMetadata(boltSnapshotFixture(view)).unresolvedSnapshots).toContainEqual({ source: own, target: digest + '-view', kind: 'child' });
});
