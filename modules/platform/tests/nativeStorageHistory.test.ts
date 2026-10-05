import { expect, test } from 'bun:test';
import { jsonHash, newResourceId } from '@crewstation/kernel';
import { RuntimeImagePhysicalScopeSchema, RUNTIME_IMAGE_PHYSICAL_KINDS } from '../../runtime-environment/domain/records';
import { ReleasePhysicalScopeSchema, RELEASE_PHYSICAL_KINDS } from '../../release/domain/release';

test('both durable owner codecs retain independent native history and reject substituted source or modified body', () => {
  const identity = jsonHash('original native source'), body = { version: 1, retainedDigests: ['sha256:' + 'a'.repeat(64)], originalFileBirth: jsonHash('old inode') };
  const nativeHistory = { version: 1 as const, identity, digest: jsonHash(body), body };
  const base = { version: 1, projectId: newResourceId(), originDigest: jsonHash('original producers'), source: { identity, epoch: jsonHash('original epoch'), version: 'native-source-v1' }, objects: [], nativeHistory };
  const image = { ...base, coverage: RUNTIME_IMAGE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash(kind), complete: true })) };
  const release = { ...base, bindings: [], coverage: RELEASE_PHYSICAL_KINDS.map(kind => ({ kind, identity: jsonHash(kind), complete: true })) };
  for (const [codec, scope] of [[RuntimeImagePhysicalScopeSchema, image], [ReleasePhysicalScopeSchema, release]] as const) {
    expect(codec.parse(JSON.parse(JSON.stringify(scope))).nativeHistory).toEqual(nativeHistory);
    expect(codec.safeParse({ ...scope, nativeHistory: { ...nativeHistory, identity: jsonHash('replacement source') } }).success).toBe(false);
    expect(codec.safeParse({ ...scope, nativeHistory: { ...nativeHistory, body: { ...body, retainedDigests: [] } } }).success).toBe(false);
    const { nativeHistory: _history, ...legacy } = scope; expect(codec.safeParse(legacy).success).toBe(true);
  }
});
