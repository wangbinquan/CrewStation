/** Read-only bbolt v2 pages used by BuildKit's native metadata store.
 * Both meta checksums, every traversed page and native EOF are validated.
 * This reader never opens a database for writing or returns a partial bucket. */
export function openBoltSnapshot(raw: Uint8Array) {
  const data = Buffer.from(raw), size = data.length >= 28 ? data.readUInt32LE(24) : 0;
  if (data.length < 8192 || data.length > 67_108_864 || size < 1024 || size > 65536 || size & size - 1 || data.length % size) throw Error('Native bbolt page size is unsupported');
  const metas = [0, size].flatMap(offset => {
    if (data.readUInt32LE(offset + 16) !== 0xed0cdaed || data.readUInt32LE(offset + 20) !== 2 || data.readUInt32LE(offset + 24) !== size
      || data.readUInt16LE(offset + 8) !== 4 || data.readBigUInt64LE(offset + 72) !== boltChecksum(data.subarray(offset + 16, offset + 72))) return [];
    return [{ root: data.readBigUInt64LE(offset + 32), pages: data.readBigUInt64LE(offset + 56), txid: data.readBigUInt64LE(offset + 64) }];
  }).sort((a, b) => a.txid > b.txid ? -1 : a.txid < b.txid ? 1 : 0);
  const meta = metas[0];
  if (!meta || meta.pages * BigInt(size) > BigInt(data.length) || metas[1]?.txid === meta.txid && metas[1].root !== meta.root) throw Error('Native bbolt meta snapshot is incomplete');
  const visited = new Set<string>(); let total = 0;
  const page = (id: bigint): Entry[] => {
    if (id < 2n || id >= meta.pages || visited.has(String(id))) throw Error('Native bbolt page is missing or repeated');
    visited.add(String(id)); const offset = Number(id) * size;
    const overflow = data.readUInt32LE(offset + 12), end = offset + (overflow + 1) * size;
    if (data.readBigUInt64LE(offset) !== id || end > data.length || end > Number(meta.pages) * size) throw Error('Native bbolt page extent changed');
    return entries(data.subarray(offset, end));
  };
  const entries = (bytes: Buffer): Entry[] => {
    if (bytes.length < 16) throw Error('Native bbolt page header is incomplete');
    const flags = bytes.readUInt16LE(8), count = bytes.readUInt16LE(10);
    if (![1, 2].includes(flags) || 16 + count * 16 > bytes.length || (total += count) > 1_000_000) throw Error('Native bbolt page layout is unsupported');
    const result: Entry[] = []; let prior: Buffer | undefined;
    for (let i = 0; i < count; i++) {
      const element = 16 + i * 16, branch = flags === 1;
      const pos = bytes.readUInt32LE(element + (branch ? 0 : 4)), keySize = bytes.readUInt32LE(element + (branch ? 4 : 8));
      const valueSize = branch ? 0 : bytes.readUInt32LE(element + 12), start = element + pos, end = start + keySize + valueSize;
      if (!keySize || start < 16 + count * 16 || end > bytes.length) throw Error('Native bbolt element extent is invalid');
      const key = bytes.subarray(start, start + keySize);
      if (prior && Buffer.compare(prior, key) >= 0) throw Error('Native bbolt keys are duplicated or unordered');
      prior = key;
      if (branch) {
        const children = page(bytes.readBigUInt64LE(element + 8));
        if (!children.length || Buffer.compare(children[0]!.key, key) !== 0 || result.length && Buffer.compare(result.at(-1)!.key, children[0]!.key) >= 0) throw Error('Native bbolt branch range changed');
        result.push(...children);
      } else {
        const kind = bytes.readUInt32LE(element); if (![0, 1].includes(kind)) throw Error('Native bbolt leaf flags are unsupported');
        result.push({ key, bucket: kind === 1, value: bytes.subarray(start + keySize, end) });
      }
    }
    return result;
  };
  const bucket = (value: Buffer): Entry[] => {
    if (value.length < 16) throw Error('Native bbolt bucket is incomplete');
    const root = value.readBigUInt64LE(0);
    return root ? page(root) : entries(value.subarray(16));
  };
  const index = (rows: Entry[]) => new Map(rows.map(row => [row.key.toString('hex'), row]));
  const root = index(page(meta.root)), buckets = new WeakMap<Entry, Map<string, Entry>>();
  return { readBucket: (path: readonly string[]) => {
    let selected = root;
    for (const name of path) {
      const original = selected.get(Buffer.from(name).toString('hex'));
      if (!original?.bucket) throw Error('Native bbolt bucket was not found');
      let current = buckets.get(original);
      if (!current) { current = index(bucket(original.value)); buckets.set(original, current); }
      selected = current;
    }
    return bucketView(selected.values());
  } };
}
interface Entry { key: Buffer; bucket: boolean; value: Buffer }
function bucketView(rows: Iterable<Entry>): ReadonlyMap<string, { bucket: boolean; value: Buffer }> {
  const result = new Map<string, { bucket: boolean; value: Buffer }>(), decoder = new TextDecoder('utf-8', { fatal: true });
  for (const row of rows) {
    const key = decoder.decode(row.key); if (result.has(key)) throw Error('Native bbolt key encoding is ambiguous');
    result.set(key, { bucket: row.bucket, value: Buffer.from(row.value) });
  }
  return result;
}
export function boltChecksum(bytes: Uint8Array): bigint {
  let hash = 14695981039346656037n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return hash;
}
