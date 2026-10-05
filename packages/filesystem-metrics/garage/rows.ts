import { decodeGarageMessagePack, garageNativeId, garageNativeRecord } from './messagepack';

export type GarageRowFamily = 'object' | 'version' | 'multipart_upload' | 'block_ref';
const markers: Record<GarageRowFamily, string[]> = { object: ['G2s3ob', 'G010s3ob', 'G09s3o'],
  version: ['G09s3v'], multipart_upload: ['G09s3mpu'], block_ref: [] };
/** Only documented v2.4.1 storage formats are accepted. Missing previous-format
 * support blocks completeness instead of silently omitting a native record. */
export function decodeGarageRow(family: GarageRowFamily, bytes: Uint8Array) {
  const marker = markers[family].find(value => Buffer.from(bytes.subarray(0, value.length)).toString() === value);
  if (markers[family].length && !marker) throw Error('garage-native-unrecognized-' + family + '-format');
  return garageNativeRecord(decodeGarageMessagePack(bytes.subarray(marker?.length ?? 0)));
}
export function garageRowKey(family: GarageRowFamily, row: Record<string, unknown>): Uint8Array {
  if (family === 'object') {
    if (typeof row['key'] !== 'string') throw Error('garage-native-object-key');
    return Buffer.concat([Buffer.from(garageNativeId(row['bucket_id']), 'hex'), Buffer.from(row['key'])]);
  }
  if (family === 'block_ref') return Buffer.from(garageNativeId(row['block']) + garageNativeId(row['version']), 'hex');
  return Buffer.from(garageNativeId(row[family === 'version' ? 'uuid' : 'upload_id']), 'hex');
}
export function garageObjectVersions(row: Record<string, unknown>) {
  if (!Array.isArray(row['versions']) || !row['versions'].length) throw Error('garage-native-object-versions-missing');
  return row['versions'].map(raw => {
    const value = garageNativeRecord(raw), id = garageNativeId(value['uuid']), state = value['state'];
    if (!Number.isSafeInteger(value['timestamp']) || Number(value['timestamp']) < 0) throw Error('garage-native-object-birth-missing');
    if (state === 'Aborted') return { id, timestamp: Number(value['timestamp']), state: 'aborted' as const, bytes: 0, blocks: [] as string[] };
    const variants = garageNativeRecord(state);
    if (Object.keys(variants).length !== 1) throw Error('garage-native-object-state-missing');
    if (Object.hasOwn(variants, 'Uploading')) return { id, timestamp: Number(value['timestamp']), state: 'uploading' as const, bytes: 0, blocks: [] as string[] };
    const complete = variants['Complete'];
    if (complete === 'DeleteMarker') return { id, timestamp: Number(value['timestamp']), state: 'deleted' as const, bytes: 0, blocks: [] as string[] };
    const payload = garageNativeRecord(complete), keys = Object.keys(payload);
    if (keys.length !== 1 || !['Inline', 'FirstBlock'].includes(keys[0]!)) throw Error('garage-native-object-payload-missing');
    const fields = payload[keys[0]!]; if (!Array.isArray(fields) || fields.length !== 2) throw Error('garage-native-object-payload-invalid');
    const meta = garageNativeRecord(fields[0]), size = meta['size'];
    if (!Number.isSafeInteger(size) || Number(size) < 0) throw Error('garage-native-object-size-missing');
    if (keys[0] === 'Inline') {
      const encryption = meta['encryption'] ? garageNativeRecord(meta['encryption']) : undefined;
      // SSE-C adds its GCM authentication tag. `size` is the plaintext size in
      // Garage's native schema; neither ciphertext nor headers leave the source.
      const encrypted = encryption && Object.hasOwn(encryption, 'SseC');
      if (encryption && Object.keys(encryption).length !== 1 || encryption && !encrypted && !Object.hasOwn(encryption, 'Plaintext')) throw Error('garage-native-encryption-invalid');
      if (!(fields[1] instanceof Uint8Array) || fields[1].byteLength !== Number(size) + (encrypted ? 16 : 0)) throw Error('garage-native-inline-bytes-invalid');
    }
    return { id, timestamp: Number(value['timestamp']), state: keys[0] === 'Inline' ? 'inline' as const : 'blocks' as const,
      bytes: Number(size), blocks: keys[0] === 'FirstBlock' ? [garageNativeId(fields[1])] : [] };
  });
}
export function garageVersionBlocks(value: unknown, hashes = new Set<string>(), depth = 0): string[] {
  if (depth > 32) throw Error('garage-native-block-map-depth');
  if (value instanceof Uint8Array || value === null || typeof value !== 'object') return [...hashes];
  if (Array.isArray(value)) for (const row of value) garageVersionBlocks(row, hashes, depth + 1);
  else {
    const row = garageNativeRecord(value);
    if (Object.hasOwn(row, 'hash')) {
      if (!Number.isSafeInteger(row['size']) || Number(row['size']) < 0) throw Error('garage-native-block-size');
      hashes.add(garageNativeId(row['hash']));
    }
    for (const [key, child] of Object.entries(row)) if (key !== 'hash') garageVersionBlocks(child, hashes, depth + 1);
  } return [...hashes].sort();
}
