import { expect, test } from 'bun:test';
import { reproduceIdentityDocument } from './documentReproduction';
import type { IdentityDocument } from './model';

test('reproduction uses original scoped keys and preserves untouched content without mutating the original', async () => {
  const id = Bun.randomUUIDv7(), document = { version: 1, rows: [{ name: 'original', mode: 'keep', secretText: 'unchanged' }, { name: 'default', mode: 'skip' }] }, before = structuredClone(document);
  const declaration: IdentityDocument = { table: 'content', column: 'original', references: [
    { path: 'rows.*.name', kind: 'scoped', keys: ['$row.owner', '$value'], when: { mode: 'keep' }, copyTo: 'id' },
    { path: 'rows.*.missing', kind: 'missing', nullable: true }, { path: 'rows.*.mode', kind: 'ignored', where: { owner: 'other' } },
    { path: 'rows.*.name', kind: 'selector', when: { mode: 'skip' }, selector: { defaultValue: 'default', valueKey: 'profileId' } },
  ], set: [{ path: 'version', value: 2 }], renames: [{ path: 'rows.*.secretText', rename: 'originalText' }] };
  const calls: string[][] = [];
  const result = await reproduceIdentityDocument(document, declaration, { owner: 'original-owner' }, async (kind, keys) => { calls.push([kind, ...keys]); return id; });
  expect(calls).toEqual([['scoped', 'original-owner', 'original']]);
  expect(result).toEqual({ version: 2, rows: [{ name: 'original', id, mode: 'keep', originalText: 'unchanged' }, { name: { kind: 'default' }, mode: 'skip' }] });
  expect(document).toEqual(before);
  await expect(reproduceIdentityDocument(document, declaration, { owner: 'original-owner' }, async () => undefined)).rejects.toThrow('unavailable');
  for (const extra of [{ stepTemplate: true }, { serializedPath: 'id' }]) await expect(reproduceIdentityDocument(document, { ...declaration, references: [{ path: 'rows.*.name', kind: 'scoped', ...extra }] }, {}, async () => id)).rejects.toThrow('Unsupported');
  await expect(reproduceIdentityDocument(document, declaration, { owner: 'original-owner' }, async () => 'not-an-id')).rejects.toThrow('UUIDv7');
});
