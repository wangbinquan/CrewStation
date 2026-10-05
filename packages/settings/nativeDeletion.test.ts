import { expect, test } from 'bun:test';
import { loadPlatformSettings } from './platformSettings';
const base = { CS_DATABASE_URL: 'postgres://test:test@localhost/test', CS_SECRET_KEY: 'test' };
test('native deletion installation defaults off and cannot accept a partial, substituted or credential-bearing source', () => {
  expect(loadPlatformSettings(base).projectDeletionNative).toBeUndefined();
  const source = { baseUrl: 'http://host.docker.internal:28739', instance: { id: 'a'.repeat(64), image: 'sha256:' + 'b'.repeat(64), startedAt: '2026-09-21T04:17:30.022274546Z', epoch: 'c'.repeat(64) } };
  const configured = { ...base, CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify(source), CS_PROJECT_DELETION_SOURCE_TOKEN: 'private-native-token'.repeat(3), CS_PROJECT_DELETION_GRANT_TOKEN: 'private-grant-token'.repeat(3) };
  expect(loadPlatformSettings(configured).projectDeletionNative?.gitlab.instance).toEqual(source.instance);
  const registry = { baseUrl: 'http://native-registry:28740/', sourceIdentity: 'd'.repeat(64), journalIdentity: 'e'.repeat(64) };
  const full = { ...configured, CS_PROJECT_DELETION_REGISTRY_SOURCE: JSON.stringify(registry), CS_PROJECT_DELETION_REGISTRY_TOKEN: 'original-private-registry-token'.repeat(3) };
  expect(loadPlatformSettings(full).projectDeletionNative?.registry).toMatchObject(registry);
  for (const env of [
    { ...configured, CS_PROJECT_DELETION_GRANT_TOKEN: '' },
    { ...configured, CS_PROJECT_DELETION_GRANT_TOKEN: configured.CS_PROJECT_DELETION_SOURCE_TOKEN },
    { ...configured, CS_PROJECT_DELETION_GITLAB_SOURCE: '{' },
    { ...configured, CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify({ ...source, baseUrl: 'http://user:secret@host/' }) },
    { ...configured, CS_PROJECT_DELETION_GITLAB_SOURCE: JSON.stringify({ ...source, instance: { ...source.instance, image: 'gitlab:latest' } }) },
    { ...full, CS_PROJECT_DELETION_REGISTRY_TOKEN: '' },
    { ...full, CS_PROJECT_DELETION_REGISTRY_TOKEN: full.CS_PROJECT_DELETION_GRANT_TOKEN },
    { ...full, CS_PROJECT_DELETION_REGISTRY_SOURCE: JSON.stringify({ ...registry, baseUrl: 'http://user:password@native-registry/' }) },
    { ...full, CS_PROJECT_DELETION_REGISTRY_SOURCE: JSON.stringify({ ...registry, journalIdentity: 'unknown' }) },
  ]) expect(() => loadPlatformSettings(env)).toThrow('配置不完整');
});
