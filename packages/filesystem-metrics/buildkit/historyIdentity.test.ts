import { expect, test } from 'bun:test';
import { buildKitHistoryIdentity } from './historyIdentity';
import { protoMessage } from './protobuf';

const ref = 'qfk2gtho4quq0ntwbha4pdrji', timestamp = protoMessage([{ number: 1, value: 1_790_784_077n }]);
const entry = (key: string, value: string) => protoMessage([{ number: 1, value: key }, { number: 2, value }]);
function original(reverse = false, credential = 'private token', output = 'a'.repeat(64)) {
  const maps = [{ number: 3, value: entry('private-key', credential) }, { number: 3, value: entry('url', 'private URL') }];
  const annotations = [{ number: 5, value: entry('annotation-a', 'private path') }, { number: 5, value: entry('annotation-b', 'private URL') }];
  const attrs = [{ number: 2, value: entry('name', 'private target') }, { number: 2, value: entry('auth', credential) }];
  const descriptor = protoMessage([{ number: 1, value: 'application/vnd.oci.image.manifest.v1+json' }, { number: 2, value: 'sha256:' + output }, ...reverse ? annotations.reverse() : annotations]);
  const result = protoMessage([{ number: 1, value: descriptor }, { number: 3, value: protoMessage([{ number: 1, value: 0n }, { number: 2, value: descriptor }]) }]);
  const results = [{ number: 11, value: protoMessage([{ number: 1, value: 'linux/amd64' }, { number: 2, value: result }]) },
    { number: 11, value: protoMessage([{ number: 1, value: 'linux/arm64' }, { number: 2, value: result }]) }];
  const fields = [{ number: 1, value: ref }, { number: 6, value: timestamp }, { number: 7, value: timestamp },
    ...reverse ? maps.reverse() : maps, { number: 4, value: protoMessage([{ number: 1, value: 'image' }, ...reverse ? attrs.reverse() : attrs]) },
    { number: 8, value: descriptor }, { number: 9, value: entry('target', credential) }, { number: 10, value: result }, ...reverse ? results.reverse() : results,
    { number: 13, value: descriptor }, { number: 18, value: descriptor }, { number: 5, value: protoMessage([{ number: 1, value: 7n }, { number: 2, value: 'private error' }, { number: 3, value: protoMessage([{ number: 1, value: 'private type' }, { number: 2, value: 'private body' }]) }]) }];
  return protoMessage(reverse ? fields.reverse() : fields);
}
test('native Go map and protobuf field ordering do not change an original history identity', () => {
  const first = original(), reordered = original(true); expect(Buffer.from(first).equals(Buffer.from(reordered))).toBe(false);
  expect(buildKitHistoryIdentity(first)).toBe(buildKitHistoryIdentity(reordered));
  expect(buildKitHistoryIdentity(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(buildKitHistoryIdentity(first)).not.toBe(buildKitHistoryIdentity(original(false, 'different private token')));
  expect(buildKitHistoryIdentity(first)).not.toBe(buildKitHistoryIdentity(original(false, 'private token', 'b'.repeat(64))));
});
test('duplicate private map keys, unknown record fields and wrong native nested wire shape fail closed', () => {
  const base = [{ number: 1, value: ref }, { number: 6, value: timestamp }];
  expect(() => buildKitHistoryIdentity(protoMessage([...base, { number: 3, value: entry('auth', 'one') }, { number: 3, value: entry('auth', 'two') }]))).toThrow('key');
  expect(() => buildKitHistoryIdentity(protoMessage([...base, { number: 20, value: 'unknown' }]))).toThrow('unsupported');
  expect(() => buildKitHistoryIdentity(protoMessage([...base, { number: 3, value: 1n }]))).toThrow('wire');
  expect(() => buildKitHistoryIdentity(protoMessage([...base, { number: 3, value: protoMessage([{ number: 1, value: 'auth' }]) }]))).toThrow('entry');
});
