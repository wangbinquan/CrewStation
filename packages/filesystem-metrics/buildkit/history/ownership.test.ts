import { expect, test } from 'bun:test';
import { buildKitHistoryOwnership } from './ownership';
import { protoMessage } from '../protobuf';
const query = { exact: ['registry:5000/project'], prefixes: ['registry:5000/runtime/projects/own'], protectedRepositories: ['registry:5000/runtime/projects/own/platform'] };
const map = (key: string, value: string) => protoMessage([{ number: 1, value: key }, { number: 2, value }]);
const history = (names: string[], extra: Array<{ number: number; value: Uint8Array }> = []) => protoMessage([{ number: 1, value: 1n }, { number: 2, value: protoMessage([
  { number: 1, value: 'a'.repeat(25) }, { number: 6, value: protoMessage([{ number: 1, value: 1n }]) }, { number: 7, value: protoMessage([{ number: 1, value: 2n }]) },
  ...names.map(name => ({ number: 4, value: protoMessage([{ number: 1, value: 'image' }, { number: 2, value: map('name', name) }]) })), ...extra,
]) }]);
test('exact native exporters classify failed and orphan attempts without interpreting a Job name as a history ref', () => {
  const failed = { number: 5, value: protoMessage([{ number: 1, value: 13n }, { number: 2, value: 'private error' }]) };
  const own = buildKitHistoryOwnership(history(['registry:5000/project:v1'], [failed]), query);
  expect(own.classification).toBe('owned'); expect(own.history.failed).toBe(true);
  expect(buildKitHistoryOwnership(history(['registry:5000/project-other:v1']), query).classification).toBe('protected');
  expect(buildKitHistoryOwnership(history(['registry:5000/runtime/projects/own/image@sha256:' + 'b'.repeat(64)]), query).classification).toBe('owned');
  expect(buildKitHistoryOwnership(history(['registry:5000/runtime/projects/own/platform:v1']), query).classification).toBe('protected');
  expect(buildKitHistoryOwnership(history(['registry:5000/project:v1,registry:5000/other:v1']), query).classification).toBe('mixed');
});
test('response-only destinations remain attributable, while missing output is explicit and private input never leaves the reader', () => {
  const privateField = { number: 3, value: map('context', 'https://private:credential@git/internal') };
  const result = buildKitHistoryOwnership(history([], [privateField, { number: 9, value: map('image.name', 'registry:5000/project:v2') }]), query);
  expect(result.classification).toBe('owned'); expect(JSON.stringify(result)).not.toContain('credential'); expect(JSON.stringify(result)).not.toContain('git/internal');
  expect(buildKitHistoryOwnership(history([], [privateField]), query).classification).toBe('unattributed');
  expect(() => buildKitHistoryOwnership(history(['registry:5000/project:v1']), { ...query, exact: [], prefixes: [] })).toThrow();
  expect(() => buildKitHistoryOwnership(history(['https://private:credential@registry/project:v1']), query)).toThrow('unsupported');
});
test('repeated ownership map keys cannot select the last value or hide a foreign destination', () => {
  expect(() => buildKitHistoryOwnership(history([], [{ number: 9, value: map('image.name', 'registry:5000/project:v1') }, { number: 9, value: map('image.name', 'registry:5000/other:v1') }]), query)).toThrow('repeated');
});
