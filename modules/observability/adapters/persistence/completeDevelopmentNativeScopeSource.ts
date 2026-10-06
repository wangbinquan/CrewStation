import { UsageExecutionIdentitySchema } from '@crewstation/contracts';
import { conflict, jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { UsageContributionEvidence } from '../../domain/completeUsageEvidence';
import { developmentCaptureSourceId } from '../../domain/developmentNative';
import type { DevelopmentNativePassMetadata, DevelopmentNativePageMetadata } from '../../domain/developmentUsage/metadata';
import type { DevelopmentNativePassProgress } from '../../domain/developmentUsage/progress';
import { developmentNativePathNamespace } from '../../domain/developmentUsage/paths';
import type { CompleteWorkingRows } from '../../ports/completeWorkingRows';
import type { CompleteNativePath, CompleteNativeScopeSource, CompletePagedUsageScope, CompleteNativeCacheFactory } from '../../ports/completeNativeScope';

interface PassRow extends Record<string, unknown> {
  document: DevelopmentNativePassMetadata; fingerprint: string; progress: DevelopmentNativePassProgress;
  task_key: string; source_id: string; state: string;
}
interface VerifiedPass extends PassRow { sourceNamespace: string }
interface PageRow extends Record<string, unknown> { document: DevelopmentNativePageMetadata; fingerprint: string; complete: boolean; task_key: string }
interface NativeSourceInput {
  readonly db: Executor; readonly rows: CompleteWorkingRows; readonly namespace: string;
  readonly keyOf: (value: string) => string; readonly cache: CompleteNativeCacheFactory; readonly signal?: AbortSignal;
}
function assertPassReference(scope: CompletePagedUsageScope, pass: VerifiedPass) {
  if (scope.native.passKey !== jsonHash({ streamSourceId: pass.document.streamSourceId, passId: pass.progress.identity.passId }) ||
      jsonHash(scope.native.identity) !== jsonHash(pass.progress.identity) ||
      jsonHash(pass.document.admission.identity) !== jsonHash(pass.progress.identity) ||
      pass.progress.identity.phase !== 'final' || pass.progress.identity.rootSessionId !== scope.root ||
      pass.document.admission.ownerReceiptId !== scope.native.ownerReceiptId ||
      pass.sourceNamespace !== scope.native.sourceNamespace || pass.document.preparation.turnIndex !== scope.turnIndex)
    throw conflict('原生范围不能替换原 final、登记、owner、轮次或实际来源');
}
/** All original parent links qualify inside the same read-only snapshot; this never updates raw metadata. */
async function qualifyOriginalGraph(input: NativeSourceInput, passKey: string, pass: PassRow, namespace: string) {
  const root = pass.progress.identity.rootSessionId;
  const totals = (await input.db.execute<{
    sessions: string; steps: string; pages: string; paths: string; bad_pages: string; bad_paths: string; roots: string; bad_edges: string; bad_steps: string;
  }>(sql`
    SELECT
      (SELECT count(*)::text FROM observability.development_native_sessions WHERE pass_key=${passKey}) AS sessions,
      (SELECT count(*)::text FROM observability.development_native_steps WHERE pass_key=${passKey}) AS steps,
      (SELECT count(*)::text FROM observability.development_native_pages WHERE pass_key=${passKey}) AS pages,
      (SELECT count(*)::text FROM observability.development_native_paths WHERE pass_key=${passKey}) AS paths,
      (SELECT count(*)::text FROM observability.development_native_pages page WHERE page.pass_key=${passKey} AND
        (NOT page.complete OR page.task_key<>${pass.task_key} OR page.ordinal::numeric>=${pass.progress.ordinal}::numeric OR (page.document->>'ordinal') IS DISTINCT FROM page.ordinal OR
         (SELECT count(*) FROM observability.development_native_packets packet WHERE packet.pass_key=page.pass_key AND packet.ordinal=page.ordinal)<>page.packet_count)) AS bad_pages,
      (SELECT count(*)::text FROM observability.development_native_sessions session LEFT JOIN observability.development_native_paths path
        ON path.pass_key=session.pass_key AND path.session_id=session.original_id WHERE session.pass_key=${passKey} AND
        (path.session_id IS NULL OR session.task_key<>${pass.task_key} OR (session.document->>'id') IS DISTINCT FROM session.original_id OR path.task_key<>${pass.task_key} OR
         path.project_id<>${pass.document.registration.identity.projectId} OR path.task_id<>${pass.document.registration.identity.taskId} OR
         path.source_namespace<>${namespace} OR path.parent_session_id IS DISTINCT FROM session.document->>'parentSessionId')) AS bad_paths,
      (SELECT count(*)::text FROM observability.development_native_paths WHERE pass_key=${passKey} AND session_id=${root} AND parent_session_id IS NULL AND depth='0' AND
         path_digest=encode(sha256(convert_to(${namespace} || ':' || octet_length(convert_to(session_id,'UTF8'))::text || ':' || session_id || ':n','UTF8')),'hex')) AS roots,
      (SELECT count(*)::text FROM observability.development_native_paths child LEFT JOIN observability.development_native_paths parent
        ON parent.pass_key=child.pass_key AND parent.session_id=child.parent_session_id WHERE child.pass_key=${passKey} AND
        (child.parent_session_id IS NULL AND (child.session_id<>${root} OR child.depth<>'0') OR child.parent_session_id IS NOT NULL AND
         (parent.session_id IS NULL OR child.depth::numeric<>parent.depth::numeric+1 OR child.source_namespace<>parent.source_namespace OR
          child.path_digest<>encode(sha256(convert_to(parent.path_digest || ':' || octet_length(convert_to(child.session_id,'UTF8'))::text || ':' || child.session_id || ':' ||
            octet_length(convert_to(parent.session_id,'UTF8'))::text || ':' || parent.session_id,'UTF8')),'hex')))) AS bad_edges,
      (SELECT count(*)::text FROM observability.development_native_steps step LEFT JOIN observability.development_native_paths path
        ON path.pass_key=step.pass_key AND path.session_id=step.document->>'sessionId' WHERE step.pass_key=${passKey} AND
        (step.task_key<>${pass.task_key} OR (step.document->>'id') IS DISTINCT FROM step.original_id OR path.session_id IS NULL OR path.parent_session_id IS DISTINCT FROM step.document->>'parentSessionId')) AS bad_steps
  `))[0]!;
  if (totals.sessions !== pass.progress.counts.sessions || totals.steps !== pass.progress.counts.steps || totals.pages !== pass.progress.ordinal ||
      totals.paths !== totals.sessions || totals.roots !== '1' ||
      [totals.bad_pages, totals.bad_paths, totals.bad_edges, totals.bad_steps].some(count => count !== '0'))
    throw conflict('原生完整父链、原页或真实 EOF 人口不一致');
}
/** Bounded caches retain only qualified original references. Every miss reads the original snapshot. */
export function completeDevelopmentNativeScopeSource(input: NativeSourceInput): CompleteNativeScopeSource {
  const passes = input.cache<VerifiedPass>(input.namespace + '/passes');
  const pages = input.cache<PageRow>(input.namespace + '/pages');
  const paths = input.cache<CompleteNativePath>(input.namespace + '/paths');
  const passFor = async (scope: CompletePagedUsageScope) => {
    input.signal?.throwIfAborted();
    const key = scope.native.passKey;
    let retained = await passes.get(key);
    if (!retained) {
      const pass = (await input.db.execute<PassRow>(sql`SELECT document,fingerprint,progress,task_key,source_id,state
        FROM observability.development_native_passes WHERE pass_key=${key}`))[0];
      if (!pass || pass.state !== 'source-eof' || !pass.progress.eof || jsonHash(pass.document) !== pass.fingerprint ||
          pass.source_id !== pass.document.streamSourceId || pass.task_key !== jsonHash({projectId: pass.document.registration.identity.projectId, taskId: pass.document.registration.identity.taskId}))
        throw conflict('原生范围仍缺同一原来源的完整 EOF');
      const sourceNamespace = developmentNativePathNamespace(pass.document);
      await qualifyOriginalGraph(input, key, pass, sourceNamespace);
      retained = { ...pass, sourceNamespace };
      await passes.put(key, retained);
    }
    assertPassReference(scope, retained);
    return retained;
  };
  const source: CompleteNativeScopeSource = {
    async qualify(record: UsageContributionEvidence) {
      const scope = record.measurement.scope;
      if (!scope || !('native' in scope)) throw conflict('原生分页范围缺失');
      const pass = await passFor(scope), identity = UsageExecutionIdentitySchema.parse(JSON.parse(record.measurement.invocationId));
      if (jsonHash(identity) !== jsonHash(pass.document.registration.identity) ||
          record.sourceId !== developmentCaptureSourceId(pass.source_id, scope.turn, scope.turnIndex))
        throw conflict('原生记录不属于独立登记的原执行与原来源');
      const key = input.keyOf(JSON.stringify([scope.native.passKey, scope.native.pageOrdinal]));
      let page = await pages.get(key);
      if (!page) {
        page = (await input.db.execute<PageRow>(sql`SELECT document,fingerprint,complete,task_key FROM observability.development_native_pages
          WHERE pass_key=${scope.native.passKey} AND ordinal=${scope.native.pageOrdinal}`))[0];
        if (!page || !page.complete || page.task_key !== pass.task_key || jsonHash(page.document) !== page.fingerprint)
          throw conflict('原生范围未保留其真实完整原页');
        await pages.put(key, page);
      }
      if (page.document.ordinal !== scope.native.pageOrdinal || page.document.cumulativeDigest !== scope.native.cumulativeDigest ||
          jsonHash(page.document.ack.identity) !== jsonHash(scope.native.identity) || page.document.ack.ownerReceiptId !== scope.native.ownerReceiptId)
        throw conflict('原生范围的原页摘要或原 ACK 身份变化');
    },
    async path(scope, session) {
      const pass = await passFor(scope), key = input.keyOf(JSON.stringify([scope.native.passKey, session]));
      let retained = await paths.get(key);
      if (!retained) {
        const row = (await input.db.execute<{ session_id: string; parent_session_id: string | null; depth: string; path_digest: string; source_namespace: string; document: {id: string; parentSessionId: string | null}; fingerprint: string }>(sql`
          SELECT path.session_id,path.parent_session_id,path.depth,path.path_digest,path.source_namespace,original.document,original.fingerprint
          FROM observability.development_native_paths path JOIN observability.development_native_sessions original
            ON original.pass_key=path.pass_key AND original.original_id=path.session_id
          WHERE path.pass_key=${scope.native.passKey} AND path.session_id=${session}`))[0];
        if (!row || row.source_namespace !== pass.sourceNamespace || row.session_id !== row.document.id ||
            row.parent_session_id !== row.document.parentSessionId || jsonHash(row.document) !== row.fingerprint)
          throw conflict('原生父引用不存在或与真实原 session 不符');
        retained = {root: pass.progress.identity.rootSessionId, session: row.session_id, parentSession: row.parent_session_id,
          depth: row.depth, pathDigest: row.path_digest, sourceNamespace: row.source_namespace};
        await paths.put(key, retained);
      }
      return retained;
    },
  };
  return source;
}
