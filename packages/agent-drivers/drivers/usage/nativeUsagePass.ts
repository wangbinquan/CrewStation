import { createHash } from 'node:crypto';
import { nativePassIdentifier } from './nativeUsagePassRows';
import { NativeUsagePassScan } from './nativeUsagePassScan';
import { NativeUsagePassStore } from './nativeUsagePassStore';
import type { NativeUsagePassIdentity, NativeUsagePassPage, NativeUsagePassReader } from './nativeUsagePassTypes';

interface NativeUsagePassOptions { readonly pageRows?: number; readonly pageBytes?: number }
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');

function packetSize(options: NativeUsagePassOptions) {
  const pageRows = options.pageRows ?? 200, pageBytes = options.pageBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(pageRows) || pageRows < 1 || pageRows > 1000
    || !Number.isSafeInteger(pageBytes) || pageBytes < 1024 || pageBytes > 1024 * 1024) {
    throw new RangeError('Invalid native pass packet size');
  }
  return { pageRows, pageBytes };
}

class NativeUsagePass implements NativeUsagePassReader {
  readonly initialCursor: string;
  readonly rootCreatedAt: number | null;
  private readonly scan: NativeUsagePassScan;
  private readonly store: NativeUsagePassStore;
  private readonly packet: ReturnType<typeof packetSize>;
  private closed = false;
  private ordinal = 0n;
  private previousDigest: string;
  private pending: NativeUsagePassPage | undefined;

  constructor(path: string, readonly identity: NativeUsagePassIdentity, options: NativeUsagePassOptions) {
    this.packet = packetSize(options);
    this.previousDigest = sha256Hex(JSON.stringify(identity));
    this.initialCursor = this.cursor();
    this.store = new NativeUsagePassStore(path, identity.rootSessionId);
    this.rootCreatedAt = this.store.rootCreatedAt;
    this.scan = new NativeUsagePassScan(this.store);
  }

  private cursor(): string {
    return JSON.stringify([this.identity.passId, this.ordinal.toString(), this.previousDigest]);
  }

  readonly next = (after: string): NativeUsagePassPage => {
    if (this.closed) throw new Error('Native snapshot closed; start a new owner pass');
    if (this.pending) {
      if (after !== this.pending.cursor) throw new Error('Native page awaits original owner ACK');
      return structuredClone(this.pending);
    }
    if (after !== this.cursor()) throw new RangeError('Native pass cursor changed snapshot or position');
    try {
      const body = { identity: this.identity, ordinal: this.ordinal.toString(),
        ...this.scan.page(this.packet.pageRows, this.packet.pageBytes) };
      const payloadDigest = sha256Hex(JSON.stringify(body));
      const cumulativeDigest = sha256Hex(JSON.stringify([this.previousDigest, payloadDigest]));
      this.pending = { ...body, cursor: after, previousDigest: this.previousDigest,
        payloadDigest, cumulativeDigest, nextCursor: body.eof ? null
          : JSON.stringify([this.identity.passId, (this.ordinal + 1n).toString(), cumulativeDigest]) };
      return structuredClone(this.pending);
    } catch (error) { this.close(); throw error; }
  };

  readonly acknowledge = (ordinal: string, digest: string): void => {
    if (this.closed || !this.pending || this.pending.ordinal !== ordinal || this.pending.payloadDigest !== digest) {
      throw new Error('Native original owner ACK changed frozen page');
    }
    const final = this.pending.nextCursor === null;
    this.previousDigest = this.pending.cumulativeDigest;
    this.ordinal++; this.pending = undefined;
    if (final) { try { this.store.commit(); } finally { this.close(); } }
  };

  readonly close = (): void => {
    if (!this.closed) { this.closed = true; this.store.close(); }
  };
}

/** An accepted owner supplies identity, persists every frozen page, then acknowledges it. */
export function openNativeUsagePass(
  path: string, acceptedIdentity: NativeUsagePassIdentity, options: NativeUsagePassOptions = {},
): NativeUsagePassReader {
  const identity = Object.freeze({ ...acceptedIdentity });
  if (Object.values(identity).some((value) => !nativePassIdentifier(value))
    || !['baseline', 'final'].includes(identity.phase)) {
    throw new RangeError('Native pass owner identity unavailable');
  }
  return new NativeUsagePass(path, identity, options);
}
