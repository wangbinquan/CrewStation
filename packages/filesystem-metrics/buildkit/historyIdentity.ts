import { createHash } from 'node:crypto';
import { protoBytes, protoFields, protoText } from './protobuf';

interface Layout { readonly nested?: Readonly<Record<number, Layout>>; readonly maps?: readonly number[]; readonly allowed: readonly number[] }
const textEntry: Layout = { allowed: [1, 2] }, timestamp: Layout = { allowed: [1, 2] };
const descriptor: Layout = { allowed: [1, 2, 3, 5], maps: [5], nested: { 5: textEntry } };
const resultEntry: Layout = { allowed: [1, 2], nested: { 2: descriptor } };
const result: Layout = { allowed: [1, 2, 3], maps: [3], nested: { 1: descriptor, 2: descriptor, 3: resultEntry } };
const resultsEntry: Layout = { allowed: [1, 2], nested: { 2: result } };
const exporter: Layout = { allowed: [1, 2], maps: [2], nested: { 2: textEntry } };
const status: Layout = { allowed: [1, 2, 3], nested: { 3: { allowed: [1, 2] } } };
const record: Layout = { allowed: Array.from({ length: 19 }, (_, index) => index + 1), maps: [3, 9, 11], nested: {
  3: textEntry, 4: exporter, 5: status, 6: timestamp, 7: timestamp, 8: descriptor, 9: textEntry, 10: result, 11: resultsEntry, 13: descriptor, 18: descriptor,
} };

function canonical(raw: Uint8Array, layout: Layout): unknown {
  const fields = protoFields(raw), groups = new Map<number, unknown[]>();
  if (fields.some(row => !layout.allowed.includes(row.number))) throw Error('Native BuildKit history fingerprint layout is unsupported');
  for (const field of fields) {
    const nested = layout.nested?.[field.number], value = nested ? canonical(field.value as Uint8Array, nested)
      : typeof field.value === 'bigint' ? field.value.toString() : Buffer.from(field.value).toString('hex');
    if (nested && field.wire !== 2) throw Error('Native BuildKit history fingerprint message wire type is invalid');
    const group = groups.get(field.number) ?? []; group.push({ wire: field.wire, value }); groups.set(field.number, group);
  }
  for (const number of layout.maps ?? []) {
    const entries = fields.filter(row => row.number === number), keys = entries.map(row => {
      const entry = protoFields(row.value as Uint8Array), key = entry.filter(field => field.number === 1);
      if (key.length > 1 || entry.filter(field => field.number === 2).length !== 1) throw Error('Native BuildKit history map entry is missing or repeated');
      return JSON.stringify(key.map(field => typeof field.value === 'bigint' ? field.value.toString() : Buffer.from(field.value).toString('hex')));
    });
    if (new Set(keys).size !== keys.length) throw Error('Native BuildKit history map key is repeated');
    groups.get(number)?.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return [...groups].sort(([a], [b]) => a - b);
}
/** Go protobuf map iteration changes its wire ordering between reads. Bind all
 * original fields through their canonical nested layout, including one-way
 * private map values, rather than hashing a nondeterministic serialization. */
export function buildKitHistoryIdentity(raw: Uint8Array) {
  const fields = protoFields(raw); protoText(fields, 1, true); protoBytes(fields, 6, true);
  return createHash('sha256').update(JSON.stringify(canonical(raw, record))).digest('hex');
}
