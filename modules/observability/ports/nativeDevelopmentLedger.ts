import type { UsageRecord, DevelopmentNativePageEvidence } from '@crewstation/contracts';
import type { DevelopmentModelEvidence } from '../domain/developmentNative';
import type { NativeLedgerReference } from '../domain/developmentUsage/nativeLedgerReference';
import type { NativeStepOwnerReceipt } from '../domain/developmentUsage/nativeStepOwner';
import type { NativeLegacyOwner } from '../domain/developmentUsage/nativeLegacyAdoption';
import type { NativeOriginalStep, NativeOriginalPage, NativeOriginalStepReference } from '../domain/developmentUsage/nativeOriginalPage';
import type { OriginalNativePassQualification } from '../domain/developmentUsage/nativeBaselineQualification';
import type { CompleteNativePath } from './completeNativeScope';
import type { UsageTaskScope, UsageMeasurementRef } from './usageLedger';
import type { DevelopmentUsageTransaction } from './developmentUsage';

/** One bounded cursor and issue vocabulary; never a copy of the full pass or its numeric population. */
export interface NativeDevelopmentWork {
  readonly passKey: string; readonly ordinal: string; readonly index: number;
  readonly visited: string; readonly held: string; readonly issues: readonly string[];
  readonly numericEof: boolean; readonly valuationEof: boolean;
  readonly baselineState?: 'before-only' | 'complete-before' | 'complete-birth' | 'unknown';
  readonly blockedAtDependencies?: string;
  readonly previousPopulation?: { readonly visited: string; readonly held: string; readonly issues: readonly string[] };
}
export interface NativeDevelopmentPageBinding {
  readonly retained: NativeOriginalPage['retained']; readonly references: readonly NativeOriginalStepReference[];
  readonly packetsComplete: boolean;
}
export interface NativeDevelopmentOwner {
  readonly state: 'missing' | 'unique' | 'ambiguous'; readonly receipt?: NativeStepOwnerReceipt; readonly usage?: UsageRecord;
}
export interface NativeDevelopmentTransaction extends DevelopmentUsageTransaction {
  nativeDependencyVersion(): Promise<string>;
  nativePendingValue(passKey: string): Promise<boolean>;
  nativePass(passKey: string): Promise<OriginalNativePassQualification>;
  nativeBefore(final: OriginalNativePassQualification): Promise<OriginalNativePassQualification | undefined>;
  nativePageBinding(passKey: string, ordinal: string): Promise<NativeDevelopmentPageBinding>;
  nativeStepReference(passKey: string, stepId: string): Promise<{ ordinal: string; index: number; fingerprint: string } | undefined>;
  nativePath(passKey: string, sessionId: string): Promise<CompleteNativePath | undefined>;
  nativeOwner(sourceNamespace: string, sessionId: string, stepId: string): Promise<NativeDevelopmentOwner>;
  nativeLegacyOwners(path: CompleteNativePath, before: NativeOriginalStep): Promise<NativeLegacyOwner[]>;
  nativeEarlierOwner(sourceNamespace: string, finalPassKey: string): Promise<boolean>;
  nativeClaim(receipt: NativeStepOwnerReceipt, path: CompleteNativePath): Promise<void>;
  nativeReference(reference: NativeLedgerReference): Promise<void>;
  nativeOriginalModel(ref: UsageMeasurementRef, revision: number): Promise<DevelopmentModelEvidence | undefined>;
  nativeWork(passKey: string): Promise<NativeDevelopmentWork>;
  nativeWorkCommit(work: NativeDevelopmentWork, processed: boolean): Promise<void>;
}
export interface NativeDevelopmentLedgerStore {
  changeNativeDevelopment<T>(scope: UsageTaskScope, sourceId: string, work: (tx: NativeDevelopmentTransaction) => Promise<T>): Promise<T>;
  pendingNativeDevelopment(after: string | null, pageSize: number, filter?: { readonly scope: UsageTaskScope; readonly sourceId: string }): Promise<{
    items: Array<{ passKey: string; scope: UsageTaskScope; sourceId: string }>;
    nextCursor: string | null;
  }>;
  pendingNativeDevelopmentValues(scope: UsageTaskScope, passKey: string, pageSize: number): Promise<UsageMeasurementRef[]>;
}
export type NativeOriginalPageReader = (pass: OriginalNativePassQualification, ordinal: string) => Promise<DevelopmentNativePageEvidence>;
