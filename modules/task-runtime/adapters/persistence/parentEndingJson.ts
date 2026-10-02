import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

export const parentEndingDocument = customType<{ data: unknown; driverData: unknown }>({
  dataType: () => 'jsonb',
  toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
  fromDriver: (value) => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value) as unknown; } catch { return value; }
  },
});

/** The actual SQL kind is authoritative: an encoded object in a JSON string remains invalid. */
export function readParentEndingJson(value: unknown, kind: string | null): unknown {
  return kind === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value : { invalidOriginalJsonKind: kind, decodedValue: value };
}
/** Explicit undefined/null is malformed presence; only a missing property becomes SQL NULL. */
export function writeParentEndingJson(record: object, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? sql`${JSON.stringify((record as Record<string, unknown>)[key]) ?? 'null'}::text::jsonb` : null;
}
