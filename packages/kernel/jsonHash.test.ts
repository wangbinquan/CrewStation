import { expect, test } from 'bun:test';
import { jsonHash } from './jsonHash';

test('provenance hashes ignore JSON object ordering and retain array order and values', () => {
  expect(jsonHash({ z: { b: 1, a: 2 }, a: [1, 2] })).toBe(jsonHash({ a: [1, 2], z: { a: 2, b: 1 } }));
  expect(jsonHash({ a: [1, 2] })).not.toBe(jsonHash({ a: [2, 1] }));
  expect(jsonHash({ a: null })).not.toBe(jsonHash({ a: 'null' }));
});
