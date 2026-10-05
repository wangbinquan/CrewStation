import type { DevelopmentUsageKey, DevelopmentUsagePage, DevelopmentUsageRegistration, DevelopmentRunnerUsageCapture } from '@crewstation/contracts';
import type { DevelopmentNativeContext, DevelopmentNativeSelection } from '../domain/developmentNative';
import type { DevelopmentModelEvidence } from "../domain/developmentNative";
import type { AcceptedExecutionPrice } from './tokenPricing';
import type { UsageLedgerTransaction, UsageTaskScope, UsageMeasurementRef } from './usageLedger';

export interface DevelopmentUsageResolved {
  registration: DevelopmentUsageRegistration; price: AcceptedExecutionPrice;
  nativeSelection?: Omit<DevelopmentNativeSelection, 'version'> & { version: 1 | 2 };
}
/** Owner and Session are independent persisted sources; never compare an owner to itself. */
export interface DevelopmentUsageSource {
  next(): Promise<DevelopmentUsagePage | undefined>;
  registration(key: DevelopmentUsageKey): Promise<DevelopmentUsageRegistration | undefined>;
  resolve(key: DevelopmentUsageKey): Promise<DevelopmentUsageResolved | undefined>;
  acknowledge(key: DevelopmentUsageKey, through: number): Promise<void>;
}
export interface DevelopmentUsageTransaction extends UsageLedgerTransaction {
  developmentModel(value: DevelopmentModelEvidence): Promise<void>;
  developmentCapture(context: DevelopmentNativeContext, frame: DevelopmentRunnerUsageCapture): Promise<void>;
}
export interface DevelopmentUsageLedgerStore {
  changeDevelopment<T>(scope: UsageTaskScope, streamSourceId: string, work: (tx: DevelopmentUsageTransaction) => Promise<T>): Promise<T>;
  developmentModel(ref: UsageMeasurementRef, revision: number): Promise<DevelopmentModelEvidence | undefined>;
}
