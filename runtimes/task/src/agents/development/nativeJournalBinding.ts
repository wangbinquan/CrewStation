import type { DevelopmentUsageKey, DevelopmentUsageReceipt } from '@crewstation/contracts';

interface NativeAuthority {
  header: string; incarnation: string; phase: DevelopmentUsageReceipt['phase'];
  interruption: DevelopmentUsageReceipt['interruption']; lastSequence: number; acknowledgedSequence: number;
}
export interface DevelopmentNativeJournalBinding {
  incarnation: string; journalId: string; podUid: string;
  eventBytes: number; pageBytes: number;
  original(key: DevelopmentUsageKey): NativeAuthority;
  committed(key: DevelopmentUsageKey): void;
}
