import type {
  NativeUsagePassAck,
  NativeUsagePassAdmission,
} from '@crewstation/contracts'
import type { NativeUsagePassIdentity, NativeUsagePassPage } from './nativeUsagePassTypes'

/** Bound to the original accepted invocation and its existing Task owner context. */
export interface NativeUsagePassOwner {
  admit(
    identity: NativeUsagePassIdentity,
    initialCursor: string,
    /** Freeze the original root birth with admission; never infer it after spawn. */
    rootCreatedAt: number | null,
  ): Promise<NativeUsagePassAdmission>
  /** Validates original binding/progress/digests; atomically saves exact page bytes,
   * membership/parents and original source rows before returning the durable ACK. */
  persist(page: NativeUsagePassPage): Promise<NativeUsagePassAck>
  /** A lost snapshot never becomes a completed pass on a later reader restart. */
  interrupt(identity: NativeUsagePassIdentity, reason: string): Promise<void>
}
export interface PersistableNativeUsagePassReader {
  readonly identity: NativeUsagePassIdentity
  readonly initialCursor: string
  readonly rootCreatedAt: number | null
  next(cursor: string): NativeUsagePassPage | Promise<NativeUsagePassPage>
  acknowledge(ordinal: string, payloadDigest: string): void | Promise<void>
  close(): void | Promise<void>
}
