import { expect, test } from 'bun:test';
import { jsonHash, textHash } from './jsonHash';

test('provenance hashes ignore JSON object ordering and retain array order and values', () => {
  expect(jsonHash({ z: { b: 1, a: 2 }, a: [1, 2] })).toBe(jsonHash({ a: [1, 2], z: { a: 2, b: 1 } }));
  expect(jsonHash({ a: [1, 2] })).not.toBe(jsonHash({ a: [2, 1] }));
  expect(jsonHash({ a: null })).not.toBe(jsonHash({ a: 'null' }));
});

test('exact original text hashing keeps JSON order and whitespace', () => {
  expect(textHash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(textHash('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  expect(textHash('{"a":1,"b":2}')).not.toBe(textHash('{"b":2,"a":1}'));
  expect(textHash(' abc')).not.toBe(textHash('abc'));
});
