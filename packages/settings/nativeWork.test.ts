import { expect, test } from 'bun:test';
import { nativeWorkSettings } from './nativeWork';
import { nativeDeletionSettings } from './nativeDeletion';
const original = { registry: { imageDigest: 'sha256:' + 'a'.repeat(64) }, buildkit: { imageDigest: 'sha256:' + 'b'.repeat(64), configIdentity: 'c'.repeat(64), args: ['--addr', 'tcp://0.0.0.0:1234'] } };
test('native work source pins the installed images and original entry, while a missing installation stays disabled', () => {
  expect(nativeWorkSettings(undefined)).toBeUndefined(); expect(nativeWorkSettings(JSON.stringify(original))).toEqual(original);
  for (const raw of [{}, { ...original, force: true }, { ...original, registry: { imageDigest: 'latest' } }, { ...original, buildkit: { ...original.buildkit, args: [] } }, { ...original, buildkit: { ...original.buildkit, command: 'other' } }])
    expect(() => nativeWorkSettings(JSON.stringify(raw))).toThrow('配置不完整');
  expect(() => nativeDeletionSettings({ CS_PROJECT_DELETION_WORK_SOURCES: JSON.stringify(original) })).toThrow('配置不完整');
});
