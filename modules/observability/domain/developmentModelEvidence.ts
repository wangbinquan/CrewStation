import type { DevelopmentUsageRegistration, RunnerUsageMeasurement, UsageExecutionIdentity } from '@crewstation/contracts';
import { jsonHash } from '@crewstation/kernel';

export interface DevelopmentModelEvidence {
  meter: { identity: UsageExecutionIdentity; sourceId: string; recordId: string };
  revision: number; streamSourceId: string; sequence: number; index: number;
  turn: string | null; turnIndex: number | null; measurementFingerprint: string;
  actualModel: RunnerUsageMeasurement['actualModel']; modelRef: string | null;
}
export const developmentMeterKey = (meter: DevelopmentModelEvidence['meter']) => jsonHash(meter);
export function sameDevelopmentRegistration(a: DevelopmentUsageRegistration, b: DevelopmentUsageRegistration): boolean {
  return jsonHash(a) === jsonHash(b);
}
/** The first page locator is retained even if identical native evidence repeats later. */
export function developmentModelFingerprint(value: DevelopmentModelEvidence): string {
  return jsonHash({ meter: value.meter, revision: value.revision, streamSourceId: value.streamSourceId,
    turn: value.turn, turnIndex: value.turnIndex, measurementFingerprint: value.measurementFingerprint,
    actualModel: value.actualModel, modelRef: value.modelRef });
}
