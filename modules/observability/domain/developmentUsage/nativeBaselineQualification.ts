import { jsonHash } from '@crewstation/kernel';
import type { DevelopmentNativePassMetadata, DevelopmentNativePageMetadata } from './metadata';
import type { DevelopmentNativePassProgress } from './progress';
import { developmentNativePathNamespace } from './paths';

export interface OriginalNativePassQualification {
  readonly key: string;
  readonly document: DevelopmentNativePassMetadata;
  readonly progress: DevelopmentNativePassProgress;
  readonly state: 'receiving' | 'source-eof';
  readonly pathsComplete: boolean;
  readonly sourceHasIssues: boolean;
  readonly eofPage: DevelopmentNativePageMetadata | null;
}
export type NativeBaselineQualification =
  | { readonly state: 'complete-before'; readonly beforePassKey: string; readonly beforeWatermark: string; readonly sourceNamespace: string }
  | { readonly state: 'complete-birth'; readonly rootCreatedAt: number; readonly sourceNamespace: string }
  | { readonly state: 'unknown'; readonly issues: readonly string[] };

export function originalNativePassFinished(pass: OriginalNativePassQualification): boolean {
  const page = pass.eofPage;
  return pass.state === 'source-eof' && pass.progress.eof && pass.pathsComplete &&
    page !== null && page.eof !== null && pass.progress.cursor === null && page.nextCursor === null &&
    pass.progress.ordinal === String(BigInt(page.ordinal) + 1n) &&
    pass.progress.previousDigest === page.cumulativeDigest && pass.progress.scanPosition === page.scanPositionAfter &&
    jsonHash(page.eof.counts) === jsonHash(pass.progress.counts) && jsonHash(page.counts) === jsonHash(pass.progress.counts) &&
    jsonHash(page.ack.identity) === jsonHash(pass.progress.identity) &&
    jsonHash(pass.document.admission.identity) === jsonHash(pass.progress.identity);
}
function completeBefore(pass: OriginalNativePassQualification): boolean {
  return originalNativePassFinished(pass) && !pass.sourceHasIssues;
}
function sameOriginalFamily(before: OriginalNativePassQualification, final: OriginalNativePassQualification): boolean {
  const a = before.progress.identity, b = final.progress.identity;
  return a.phase === 'baseline' && b.phase === 'final' && a.passId !== b.passId &&
    a.turn === b.turn && a.nativeSource === b.nativeSource && a.sourceGeneration === b.sourceGeneration &&
    a.rootSessionId === b.rootSessionId && a.lineageKey === b.lineageKey && a.epoch === b.epoch &&
    jsonHash(before.document.key) === jsonHash(final.document.key) &&
    jsonHash(before.document.registration) === jsonHash(final.document.registration) &&
    jsonHash(before.document.preparation) === jsonHash(final.document.preparation) &&
    before.document.streamSourceId === final.document.streamSourceId &&
    developmentNativePathNamespace(before.document) === developmentNativePathNamespace(final.document);
}
/** A missing original step is zero only after an actual complete before, or proved root birth. */
export function qualifyNativeBaseline(input: {
  readonly final: OriginalNativePassQualification;
  readonly before?: OriginalNativePassQualification;
  /** Earlier owners exclude claims already committed by this exact final pass. */
  readonly earlierOwnerExists: boolean;
}): NativeBaselineQualification {
  const { final, before } = input;
  // A final page's numeric issue cannot hide other faithfully retained steps.
  // The caller retains those issues as incomplete capture quality.
  if (!originalNativePassFinished(final) || final.progress.identity.phase !== 'final')
    return { state: 'unknown', issues: ['native-final-source-incomplete'] };
  const sourceNamespace = developmentNativePathNamespace(final.document);
  if (final.document.baselineKind === 'resume') {
    if (!before || !sameOriginalFamily(before, final))
      return { state: 'unknown', issues: ['native-before-source-unmatched'] };
    if (!completeBefore(before))
      return { state: 'unknown', issues: ['native-before-source-incomplete'] };
    if (BigInt(before.progress.sourceWatermark) > BigInt(final.document.admission.sourceWatermark) ||
        BigInt(before.progress.sourceWatermark) >= BigInt(final.progress.sourceWatermark))
      return { state: 'unknown', issues: ['native-before-order-unmatched'] };
    return { state: 'complete-before', beforePassKey: before.key, beforeWatermark: before.progress.sourceWatermark, sourceNamespace };
  }
  const born = final.document.rootCreatedAt, prepared = Date.parse(final.document.preparation.observedAt);
  if (born === null || !Number.isSafeInteger(born) || !Number.isFinite(prepared) || born < prepared)
    return { state: 'unknown', issues: ['native-root-birth-unproved'] };
  if (input.earlierOwnerExists)
    return { state: 'unknown', issues: ['native-existing-owner-in-fresh-root'] };
  return { state: 'complete-birth', rootCreatedAt: born, sourceNamespace };
}
