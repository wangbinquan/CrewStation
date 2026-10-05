import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildKitHistory } from '../controlRecords';
import { protoBytes, protoFields, protoText } from '../protobuf';

const repository = z.string().max(512).regex(/^[a-z0-9]+(?:[.:-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/);
export const BuildKitHistoryQuerySchema = z.strictObject({ exact: z.array(repository).max(128), prefixes: z.array(repository).max(128), protectedRepositories: z.array(repository).max(10_000) })
  .refine(value => value.exact.length + value.prefixes.length > 0 && [value.exact, value.prefixes, value.protectedRepositories].every(rows => new Set(rows).size === rows.length));
export type BuildKitHistoryQuery = z.infer<typeof BuildKitHistoryQuerySchema>;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function textMap(fields: ReturnType<typeof protoFields>, number: number) {
  const values = new Map<string, string>();
  for (const row of fields.filter(row => row.number === number)) {
    if (row.wire !== 2) throw Error('Native BuildKit ownership map wire type is invalid');
    const entry = protoFields(row.value as Uint8Array), key = protoText(entry, 1, true)!, value = protoText(entry, 2) ?? '';
    if (values.has(key)) throw Error('Native BuildKit ownership map key is repeated');
    values.set(key, value);
  }
  return values;
}
function destination(raw: string) {
  const match = /^(.+?)(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})?$/.exec(raw);
  if (!match || !repository.safeParse(match[1]).success || /[\s?#]/.test(raw)) throw Error('Native BuildKit image destination is unsupported');
  return match[1]!;
}
/** Classify the original exporter destinations without returning frontend
 * URLs, commands, credentials or private exporter attributes. Failed builds
 * still retain their original destination; a Job name is never a history ref. */
export function buildKitHistoryOwnership(raw: Uint8Array, rawQuery: BuildKitHistoryQuery) {
  const query = BuildKitHistoryQuerySchema.parse(rawQuery), history = buildKitHistory(raw), body = protoFields(protoBytes(protoFields(raw), 2, true)!);
  const outputs: string[] = [];
  for (const row of body.filter(row => row.number === 4)) {
    if (row.wire !== 2) throw Error('Native BuildKit exporter wire type is invalid');
    const exporter = protoFields(row.value as Uint8Array), type = protoText(exporter, 1, true), attrs = textMap(exporter, 2);
    if (type === 'image' || type === 'registry') { const names = attrs.get('name'); if (names) outputs.push(...names.split(',').map(destination)); }
  }
  const response = textMap(body, 9).get('image.name');
  if (response) outputs.push(...response.split(',').map(destination));
  const destinations = [...new Set(outputs)].sort(), selected = destinations.filter(name => !query.protectedRepositories.includes(name)
    && (query.exact.includes(name) || query.prefixes.some(prefix => name.startsWith(prefix + '/'))));
  const classification = !destinations.length ? 'unattributed' : !selected.length ? 'protected' : selected.length === destinations.length ? 'owned' : 'mixed';
  return { history, classification, destinationsIdentity: hash(destinations), queryIdentity: hash(query) } as const;
}
