import type { BusinessStartupInventory } from './startupInventory';
import { expect, test } from 'bun:test';
import { boundedStartupInventory, BusinessStartupInventorySchema } from './startupInventory';
const inventory: Extract<BusinessStartupInventory, { state: 'verified' }> = { version: 1, state: 'verified', source: 'claude-init', mcpServers: [{ name: 'docs', status: 'connected' }] };
test('verified inventory preserves absent faces and rejects paths, duplicates and secret-bearing unknown fields', () => {
  expect(boundedStartupInventory(inventory)).toEqual(inventory);
  expect(BusinessStartupInventorySchema.safeParse({ ...inventory, mcpServers: [{ name: 'docs', status: 'connected', headers: { authorization: 'private' } }] }).success).toBe(false);
  for (const agents of [['/work/private'], ['a', 'a'], ['name\nprivate']]) expect(boundedStartupInventory({ ...inventory, agents })).toMatchObject({ state: 'malformed' });
  expect(boundedStartupInventory({ ...inventory, agents: [] })).toEqual({ ...inventory, agents: [] });
});
test('oversize and corrupt inventory never retains rejected bytes or a verified label', () => {
  expect(boundedStartupInventory({ ...inventory, agents: ['x'.repeat(300_000)] })).toEqual({ version: 1, state: 'unavailable', reason: 'inventory-too-large' });
  expect(boundedStartupInventory({ state: 'verified', secret: 'private' })).toEqual({ version: 1, state: 'malformed', reason: 'inventory-malformed' });
  expect(boundedStartupInventory(1n)).toMatchObject({ state: 'malformed' });
});
