import { createHash } from 'node:crypto';

/** Stable across JSONB round trips; object ordering is irrelevant, array ordering is preserved. */
export function jsonHash(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
  return createHash('sha256').update(serialized).digest('hex');
}
