import type { DevelopmentNativePreparation, DevelopmentNativeStore } from '@crewstation/contracts';
import type { NativeUsagePassOwner } from '../drivers/usage/nativeUsageOwner';

export interface DevelopmentNativeTurnInput {
  readonly turn: string;
  readonly turnIndex: number;
  readonly resumeSessionId: string | null;
  readonly observedAt: string;
  readonly plannedPathDigest: string;
  readonly store: Extract<DevelopmentNativeStore, { state: 'observed' }>;
}

/** Original accepted key, Pod and FULL/WAL journal remain inside the runtime owner closure. */
export interface DevelopmentNativeProducer {
  readonly lineageKey: string;
  beginTurn(input: DevelopmentNativeTurnInput): void;
  owner(prepared: DevelopmentNativePreparation, rootCreatedAt: number | null): NativeUsagePassOwner;
  interrupted(): void;
}

export interface DevelopmentNativePagedCapture {
  finish(rootSessionId: string | undefined, issues: readonly string[]): Promise<void>;
}
