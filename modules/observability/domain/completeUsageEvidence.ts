import type { UsageRecord } from '@crewstation/contracts';
import type { TokenBucket, TokenUsage } from './tokenUsage';

/** The original CS model reference and complete execution identity remain opaque. */
export interface UsageContributionEvidence {
  readonly sourceId: string;
  readonly measurement: {
    readonly invocationId: string;
    readonly recordId: string;
    readonly model: { readonly provider: null; readonly id: string } | null;
    readonly scope?: NonNullable<UsageRecord['scope']>;
    readonly coveredThroughTurn?: number;
  };
  readonly contribution: TokenUsage;
  readonly complete: boolean;
  readonly coveredThrough?: Readonly<Record<TokenBucket, number | null>>;
}

export function runtimeContributionEvidence<T extends UsageRecord>(record: T): UsageContributionEvidence & { readonly original: T } {
  return {
    original: record,
    sourceId: record.sourceId,
    measurement: {
      invocationId: JSON.stringify(record.identity),
      recordId: record.recordId,
      model: record.modelRef === null ? null : { provider: null, id: record.modelRef },
      ...(record.scope === null ? {} : { scope: record.scope }),
      ...(record.coveredThroughTurn === null ? {} : { coveredThroughTurn: record.coveredThroughTurn }),
    },
    contribution: record.projection.contribution,
    complete: record.projection.complete,
    ...(record.projection.coveredThrough === null ? {} : { coveredThrough: record.projection.coveredThrough }),
  };
}
