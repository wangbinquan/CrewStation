import { z } from 'zod';
import { BUSINESS_EXECUTION_LIMITS } from './executionValues';

const name = z.string().min(1).max(512).regex(/^[A-Za-z0-9][A-Za-z0-9_.:@*-]*$/);
const names = z.array(name).max(2048).refine((values) => new Set(values).size === values.length, '清单名称重复');
const reason = z.enum(['inventory-not-reported', 'inventory-unavailable', 'inventory-malformed', 'inventory-too-large', 'inventory-identity-mismatch', 'inventory-cancelled', 'inventory-start-failed']);
export const BusinessStartupInventorySchema = z.discriminatedUnion('state', [
  z.strictObject({ version: z.literal(1), state: z.literal('verified'), source: z.enum(['claude-init', 'opencode-inventory']),
    mcpServers: z.array(z.strictObject({ name, status: z.enum(['connected', 'failed', 'disabled', 'unknown']) })).max(2048).refine((entries) => new Set(entries.map((entry) => entry.name)).size === entries.length, 'MCP 名称重复'),
    agents: names.optional(), skills: names.optional(), tools: names.optional(),
  }),
  z.strictObject({ version: z.literal(1), state: z.literal('unavailable'), reason }),
  z.strictObject({ version: z.literal(1), state: z.literal('malformed'), reason }),
]);
export type BusinessStartupInventory = z.infer<typeof BusinessStartupInventorySchema>;
/** Leave room for execution identity, cursor and JSON envelope. Never truncate and keep a verified label. */
export const STARTUP_INVENTORY_BYTES = BUSINESS_EXECUTION_LIMITS.eventBytes - 8192;
export function boundedStartupInventory(raw: unknown): BusinessStartupInventory {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength; } catch { return { version: 1, state: 'malformed', reason: 'inventory-malformed' }; }
  if (bytes > STARTUP_INVENTORY_BYTES) return { version: 1, state: 'unavailable', reason: 'inventory-too-large' };
  const parsed = BusinessStartupInventorySchema.safeParse(raw);
  return parsed.success ? parsed.data : { version: 1, state: 'malformed', reason: 'inventory-malformed' };
}
