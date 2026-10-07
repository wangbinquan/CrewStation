import type { DevelopmentUsageRegistration, DevelopmentNativeSource, NativeUsageProof, RunnerUsageMeasurement, UsageExecutionIdentity } from "@crewstation/contracts";
import { conflict, jsonHash } from "@crewstation/kernel";

export interface DevelopmentNativeSelection { version: 1 | 2; expectedNamespace: string }
export interface DevelopmentNativeContext {
  registration: DevelopmentUsageRegistration; streamSourceId: string;
  selection?: DevelopmentNativeSelection;
}
/** Private source metadata never creates a second numeric ledger. */
export interface DevelopmentNativeState extends DevelopmentNativeContext {
  begin: DevelopmentNativeSource | null; finish: DevelopmentNativeSource | null;
  beginRoot?: string | null; finishRoot?: string | null; baselineKind: NativeUsageProof['baseline']['kind'];
  sourceVerified: boolean; overflow: boolean;
}
export function developmentStreamId(registration: DevelopmentUsageRegistration): string {
  return 'development:' + jsonHash(registration);
}
export function developmentCaptureSourceId(streamSourceId: string, turn: string | null, turnIndex: number | null): string {
  return turn === null ? streamSourceId : 'development-capture:' + jsonHash({ streamSourceId, turn, turnIndex });
}
function verified(begin: DevelopmentNativeSource | null, finish: DevelopmentNativeSource | null, proof: NativeUsageProof): boolean {
  if (!begin || !finish || finish.finalStore?.state !== 'observed' || begin.plannedPathDigest === null ||
      begin.plannedPathDigest !== finish.plannedPathDigest || begin.issues.length || finish.issues.length ||
      finish.scope !== 'execution-local') return false;
  return finish.continuity === 'same' || proof.baseline.kind === 'fresh' && finish.continuity === 'new';
}
/** Finish may arrive before begin, but cannot manufacture the retained begin identity. */
export function developmentNativeState(before: DevelopmentNativeState | undefined, context: DevelopmentNativeContext,
  proof: NativeUsageProof, source?: DevelopmentNativeSource): DevelopmentNativeState {
  if (before && jsonHash({ registration: before.registration, streamSourceId: before.streamSourceId, selection: before.selection ?? null }) !==
      jsonHash({ ...context, selection: context.selection ?? null })) throw conflict('开发原生来源归属冲突');
  if (context.selection && proof.lineageKey !== context.selection.expectedNamespace) throw conflict('开发原生来源与原选择命名空间不符');
  if (source && (!context.selection || source.lineageKey !== context.selection.expectedNamespace ||
      source.turn !== proof.turn || source.turnIndex !== proof.turnIndex || source.observedAt !== proof.observedAt)) throw conflict('开发原生来源未绑定原选择与证明');
  const state: DevelopmentNativeState = { ...context, begin: before?.begin ?? null, finish: before?.finish ?? null,
    ...(before?.beginRoot === undefined ? {} : { beginRoot: before.beginRoot }),
    ...(before?.finishRoot === undefined ? {} : { finishRoot: before.finishRoot }),
    baselineKind: before?.baselineKind ?? proof.baseline.kind,
    sourceVerified: before?.sourceVerified ?? false, overflow: before?.overflow ?? false };
  if (source) {
    const previous = source.stage === 'begin' ? state.begin : state.finish;
    const previousRoot = source.stage === 'begin' ? state.beginRoot : state.finishRoot;
    if (previous && (jsonHash(previous) !== jsonHash(source) || previousRoot !== undefined && previousRoot !== proof.root))
      throw conflict('开发原生来源同阶段内容冲突');
    if (!previous) {
      if (source.stage === 'begin') { state.begin = source; state.beginRoot = proof.root; }
      else { state.finish = source; state.finishRoot = proof.root; }
    }
  }
  if (state.begin && state.finish && (jsonHash(state.begin.beginStore) !== jsonHash(state.finish.beginStore) ||
      state.begin.turn !== state.finish.turn || state.begin.turnIndex !== state.finish.turnIndex ||
      state.begin.plannedPathDigest !== state.finish.plannedPathDigest)) throw conflict('开发最终来源不能替换已持久开始证明');
  state.sourceVerified = context.selection?.version === 1 && verified(state.begin, state.finish, proof);
  return state;
}
/** Actual file continuity alone cannot prove that both stages refer to the original native root. */
export function developmentNativeRootChanged(state: DevelopmentNativeState): boolean {
  return typeof state.beginRoot === 'string' && typeof state.finishRoot === 'string' && state.beginRoot !== state.finishRoot;
}
export function developmentNativeRootUsable(state: DevelopmentNativeState): boolean {
  return !!state.begin && !!state.finish && typeof state.finishRoot === 'string' &&
    (state.beginRoot === null && state.baselineKind === 'fresh' || typeof state.beginRoot === 'string' && state.beginRoot === state.finishRoot);
}
export function developmentNativePrefix(captureId: string, state: DevelopmentNativeState): string {
  const store = state.finish?.finalStore;
  return state.sourceVerified && developmentNativeRootUsable(state) && state.selection && store?.state === 'observed'
    ? 'development-store:' + jsonHash({ namespace: state.selection.expectedNamespace, podUid: state.registration.podUid,
      sourceEpoch: store.sourceEpoch, actualPathDigest: store.actualPathDigest, fileIdentityDigest: store.fileIdentityDigest }) + ':'
    : 'development-pending:' + captureId + ':';
}

export interface DevelopmentModelEvidence {
  meter: { identity: UsageExecutionIdentity; sourceId: string; recordId: string };
  revision: number; streamSourceId: string; sequence: number; index: number;
  turn: string | null; turnIndex: number | null; measurementFingerprint: string;
  native?: { passKey: string; ordinal: string; stepIndex: number; originalDocumentDigest: string;
    sourceTurn: string; sourceTurnIndex: number; sourceWatermark: string };
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
    actualModel: value.actualModel, modelRef: value.modelRef, ...(value.native ? { native: value.native } : {}) });
}
