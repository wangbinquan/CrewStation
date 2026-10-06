import type { CompleteWorkingRows, CompleteWorkingPage } from '../../ports/completeWorkingRows';
import type { CompleteNativePath, CompleteNativeScopeSource, CompletePagedUsageScope, CompleteNativeCacheFactory } from '../../ports/completeNativeScope';
import type { UsageContributionEvidence } from '../../domain/completeUsageEvidence';
import { completeUsageGroup } from '../../domain/completeUsageOrder';
import { developmentNativePathDigest } from '../../domain/developmentUsage/paths';

interface NativeBinding extends CompleteNativePath { readonly group: string }
interface NativeWorkspaceInput {
  readonly rows: CompleteWorkingRows;
  readonly namespace: string;
  readonly keyOf: (value: string) => string;
  readonly source: CompleteNativeScopeSource;
  readonly cache: CompleteNativeCacheFactory;
  readonly legacyPath: (group: string, session: string) => Promise<string | undefined>;
  readonly signal?: AbortSignal;
}
function matchesOriginalPath(scope: CompletePagedUsageScope, path: CompleteNativePath, session: string, depth: bigint) {
  if (path.root !== scope.root || path.session !== session || path.depth !== depth.toString() ||
      path.sourceNamespace !== scope.native.sourceNamespace ||
      (depth === 0n) !== (session === scope.root && path.parentSession === null) ||
      path.parentSession === session || (depth > 0n && path.parentSession === null))
    throw new Error('Original native parent path changed');
}
async function* originalParents(input: NativeWorkspaceInput, scope: CompletePagedUsageScope) {
  let session = scope.session, depth = BigInt(scope.native.depth), first = true;
  let child: CompleteNativePath | undefined;
  for (;;) {
    input.signal?.throwIfAborted();
    const path = await input.source.path(scope, session);
    matchesOriginalPath(scope, path, session, depth);
    if (first && (path.pathDigest !== scope.native.pathDigest || path.parentSession !== scope.parentSession))
      throw new Error('Original native scope path reference changed');
    if (child && child.pathDigest !== developmentNativePathDigest(path.pathDigest, child.session, path.session))
      throw new Error('Original native parent digest changed');
    if (path.parentSession === null && path.pathDigest !== developmentNativePathDigest(path.sourceNamespace, path.session, null))
      throw new Error('Original native root digest changed');
    first = false;
    yield path;
    if (path.parentSession === null) return;
    child = path; session = path.parentSession; depth--;
  }
}
function sameBinding(a: NativeBinding, b: NativeBinding) {
  return a.group === b.group && a.root === b.root && a.session === b.session && a.parentSession === b.parentSession &&
    a.depth === b.depth && a.pathDigest === b.pathDigest && a.sourceNamespace === b.sourceNamespace;
}
function originalLegacyDigest(binding: NativeBinding, retained: string) {
  const ancestors: unknown = JSON.parse(retained);
  if (!Array.isArray(ancestors) || !ancestors.every((value): value is string => typeof value === 'string'))
    throw new Error('Original legacy ancestry binding invalid');
  if (String(ancestors.length) !== binding.depth ||
      (ancestors[0] ?? binding.session) !== binding.root || (ancestors.at(-1) ?? null) !== binding.parentSession)
    throw new Error('Conflicting observation session ancestry');
  let fingerprint = binding.sourceNamespace, parent: string | null = null;
  for (const session of [...ancestors, binding.session]) {
    fingerprint = developmentNativePathDigest(fingerprint, session, parent);
    parent = session;
  }
  if (fingerprint !== binding.pathDigest) throw new Error('Conflicting observation session ancestry');
}
/** Only derived constant-size parent bindings. All original records remain in their original ledger. */
export function completeNativeScopeWorkspace(input: NativeWorkspaceInput) {
  let hasNative = false;
  const bindings = input.cache<NativeBinding>(input.namespace);
  const key = (group: string, session: string) => input.keyOf(JSON.stringify([group, session]));
  return {
    async bind(record: UsageContributionEvidence) {
      const scope = record.measurement.scope;
      if (!scope || !('native' in scope)) throw new Error('Paged native scope required');
      await input.source.qualify(record);
      hasNative = true;
      const group = completeUsageGroup(record);
      for await (const path of originalParents(input, scope)) {
        const id = key(group, path.session), previous = await bindings.get(id), document = { group, ...path };
        if (previous && !sameBinding(previous, document))
          throw new Error('Conflicting observation native parent binding');
        if (!previous) await bindings.put(id, document);
      }
    },
    async qualifyMixed() {
      if (!hasNative) return;
      await bindings.flush();
      let cursor: string | null = null;
      for (;;) {
        input.signal?.throwIfAborted();
        const page: CompleteWorkingPage<NativeBinding> = await input.rows.page<NativeBinding>(input.namespace, cursor, 100);
        for (const { key: actual, document } of page.items) {
          if (actual !== key(document.group, document.session)) throw new Error('Original native parent binding identity changed');
          const retained = await input.legacyPath(document.group, document.session);
          if (retained !== undefined) originalLegacyDigest(document, retained);
        }
        if (page.nextCursor === null) return;
        if (!page.items.length || page.nextCursor !== page.items.at(-1)!.key || page.nextCursor === cursor)
          throw new Error('Original native ancestry cursor did not advance');
        cursor = page.nextCursor;
      }
    },
    async *sessions(record: UsageContributionEvidence) {
      const scope = record.measurement.scope;
      if (!scope || !('native' in scope)) throw new Error('Paged native scope required');
      let own = true;
      for await (const path of originalParents(input, scope)) {
        const retained = await bindings.get(key(completeUsageGroup(record), path.session));
        if (!retained || !sameBinding(retained, { group: completeUsageGroup(record), ...path }))
          throw new Error('Original native ancestry was not qualified');
        yield { id: path.session, treeOnly: !own };
        own = false;
      }
    },
  };
}
