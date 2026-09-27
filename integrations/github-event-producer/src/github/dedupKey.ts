import { createHash } from 'node:crypto';
import { record } from './eventType';

/** Delivery UUID survives GitHub redelivery. Fingerprint fallback is observable and weaker for identical occurrences. */
export function deriveDedupKey(eventType: string, headers: Headers, payload: unknown): { key: string; source: string } {
  const delivery = headers.get('x-github-delivery')?.trim();
  const source = delivery ? 'delivery-id' : 'payload-fingerprint';
  const value = delivery ? `delivery:${delivery}` : `sha256:${hash(JSON.stringify([headers.get('x-github-event'), canonical(payload)]))}`;
  const key = `${eventType}|${value}`;
  return { key: key.length <= 200 ? key : `${eventType}|sha256:${hash(key)}`, source };
}
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const object = record(value);
  return object ? Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonical(object[key])])) : value;
}
