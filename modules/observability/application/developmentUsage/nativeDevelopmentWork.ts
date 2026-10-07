import { conflict } from '@crewstation/kernel';
import type { UsageTaskScope, UsageMeasurementRef } from '../../ports/usageLedger';
import type { NativeDevelopmentLedgerStore, NativeDevelopmentTransaction, NativeDevelopmentWork, NativeOriginalPageReader } from '../../ports/nativeDevelopmentLedger';
import { developmentNativePathNamespace } from '../../domain/developmentUsage/paths';
import { qualifyNativeBaseline, type OriginalNativePassQualification } from '../../domain/developmentUsage/nativeBaselineQualification';
import { prepareNativeOriginalPage, originalNativeStep, type NativeOriginalPage } from '../../domain/developmentUsage/nativeOriginalPage';
import { commitNativeOriginalStep } from './nativeNumericCommit';

function originalPages(tx: NativeDevelopmentTransaction, read: NativeOriginalPageReader) {
  // Two source pages cached for transport efficiency; every pass/page continues to actual EOF.
  const cache = new Map<string, NativeOriginalPage>();
  return async (pass: OriginalNativePassQualification, ordinal: string) => {
    const key = pass.key + ':' + ordinal, retained = cache.get(key);
    if (retained) return retained;
    const binding = await tx.nativePageBinding(pass.key, ordinal);
    const source = prepareNativeOriginalPage({ ...binding, passKey: pass.key, pass: pass.document,
      original: await read(pass, ordinal) });
    if (cache.size === 2) cache.delete(cache.keys().next().value!);
    cache.set(key, source); return source;
  };
}
async function numericWork(tx: NativeDevelopmentTransaction, passKey: string, read: NativeOriginalPageReader, observedAt: string) {
  let pass = await tx.nativePass(passKey);
  const work = await tx.nativeWork(passKey);
  if (work.baselineState && (work.numericEof || work.blockedAtDependencies === await tx.nativeDependencyVersion())) return work;
  if (pass.state !== 'source-eof') return work;
  if (!pass.pathsComplete) {
    const paths = await tx.developmentPaths(passKey); pass = await tx.nativePass(passKey);
    if (!pass.pathsComplete) {
      const blocked = { ...work, issues: paths.issues, blockedAtDependencies: await tx.nativeDependencyVersion() };
      await tx.nativeWorkCommit(blocked, false); return blocked;
    }
  }
  const pages = originalPages(tx, read);
  let before = pass.document.baselineKind === 'resume' && pass.progress.identity.phase === 'final' ? await tx.nativeBefore(pass) : undefined;
  if (before?.state === 'source-eof' && !before.pathsComplete) { await tx.developmentPaths(before.key); before = await tx.nativeBefore(pass); }
  const baseline = qualifyNativeBaseline({ final: pass, ...(before ? { before } : {}),
    earlierOwnerExists: await tx.nativeEarlierOwner(developmentNativePathNamespace(pass.document), passKey) });
  const baselineState = pass.progress.identity.phase === 'baseline' ? 'before-only' : baseline.state;
  if (work.numericEof) {
    const qualified: NativeDevelopmentWork = { ...work, baselineState };
    await tx.nativeWorkCommit(qualified, qualified.valuationEof && qualified.held === '0'); return qualified;
  }
  const source = await pages(pass, work.ordinal);
  const issues = new Set([...work.issues, ...source.page.issues, ...(baselineState === 'unknown' && baseline.state === 'unknown' ? baseline.issues : [])]);
  let held = BigInt(work.held), visited = BigInt(work.visited);
  const through = Math.min(source.page.steps.length, work.index + 100);
  for (let index = work.index; index < through; index++) {
    const original = originalNativeStep(source, index);
    if (pass.progress.identity.phase === 'final') {
      const ref = before && baseline.state === 'complete-before' ? await tx.nativeStepReference(before.key, original.step.stepId) : undefined;
      const beforeStep = ref ? originalNativeStep(await pages(before!, ref.ordinal), ref.index) : undefined;
      if (beforeStep && (beforeStep.fingerprint !== ref!.fingerprint || beforeStep.step.stepId !== original.step.stepId))
        throw conflict('原生 before 步骤未匹配其独立原页引用');
      const gaps = await commitNativeOriginalStep({ tx, original, baseline, ...(beforeStep ? { before: beforeStep } : {}), observedAt });
      if (gaps.length) { held++; for (const issue of gaps) issues.add(issue); }
    }
    visited++;
  }
  const pageDone = through === source.page.steps.length;
  const next: NativeDevelopmentWork = { ...work, baselineState, index: pageDone ? 0 : through,
    ordinal: pageDone ? String(BigInt(work.ordinal) + 1n) : work.ordinal, visited: String(visited), held: String(held),
    issues: [...issues], numericEof: pageDone && source.page.eof !== null, valuationEof: false };
  await tx.nativeWorkCommit(next, false);
  return next;
}
/** Numeric work survives ordinary source ACK and commits on the original task head. */
export function nativeDevelopmentWork(deps: { store: NativeDevelopmentLedgerStore; read: NativeOriginalPageReader;
  value: (refs: readonly UsageMeasurementRef[]) => Promise<void>; now: () => string }) {
  return async (input: { passKey: string; scope: UsageTaskScope; sourceId: string }) => {
    const work = await deps.store.changeNativeDevelopment(input.scope, input.sourceId,
      tx => numericWork(tx, input.passKey, deps.read, deps.now()));
    if (!work.numericEof) return { processed: false, work };
    const values = await deps.store.pendingNativeDevelopmentValues(input.scope, input.passKey, 100);
    await deps.value(values);
    if ((await deps.store.pendingNativeDevelopmentValues(input.scope, input.passKey, 100)).length)
      return { processed: false, work };
    return deps.store.changeNativeDevelopment(input.scope, input.sourceId, async tx => {
      const current = await tx.nativeWork(input.passKey);
      if (!current.numericEof || await tx.nativePendingValue(input.passKey)) return { processed: false, work: current };
      if (current.valuationEof && current.held === '0') return { processed: true, work: current };
      const processed = current.held === '0';
      const next: NativeDevelopmentWork = processed ? { ...current, valuationEof: true } : {
        passKey: current.passKey, ordinal: '0', index: 0, visited: '0', held: '0', issues: [], numericEof: false, valuationEof: false,
        ...(current.baselineState ? { baselineState: current.baselineState } : {}),
        previousPopulation: { visited: current.visited, held: current.held, issues: current.issues },
        blockedAtDependencies: await tx.nativeDependencyVersion(),
      };
      await tx.nativeWorkCommit(next, processed);
      return { processed, work: next };
    });
  };
}
