import { expect, test } from 'bun:test';
import { DevelopmentUsageStorageSchema } from './developmentUsage';

test('development numeric layout is an explicit v1 selection and rejects partial or unknown fields', () => {
  expect(DevelopmentUsageStorageSchema.parse({ version: 1 })).toEqual({ version: 1 });
  for (const input of [undefined, null, {}, { version: 0 }, { version: 2 }, { version: '1' }, { version: 1, directory: '/work' }]) expect(DevelopmentUsageStorageSchema.safeParse(input).success).toBe(false);
});
