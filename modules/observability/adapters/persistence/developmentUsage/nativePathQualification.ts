import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentNativePassMetadata } from '../../../domain/developmentUsage/metadata';
import type { DevelopmentNativePassProgress } from '../../../domain/developmentUsage/progress';
import { developmentNativePathNamespace } from '../../../domain/developmentUsage/paths';

/** Validate every retained parent/digest and the actual EOF population without issuing a no-op INSERT/report-clock change. */
export async function readNativePathQualification(db: Executor, passKey: string,
  pass: DevelopmentNativePassMetadata, progress: DevelopmentNativePassProgress): Promise<boolean> {
  if (!progress.eof) return false;
  const namespace = developmentNativePathNamespace(pass), root = progress.identity.rootSessionId;
  const row = (await db.execute<{ paths: string; invalid: string; roots: string; sessions: string; steps: string; unmatched_steps: string }>(sql`
    SELECT count(*)::text AS paths,
      count(*) filter (where original.original_id IS NULL OR p.source_namespace<>${namespace}
        OR p.parent_session_id IS DISTINCT FROM original.document->>'parentSessionId'
        OR CASE WHEN p.session_id=${root} THEN p.parent_session_id IS NOT NULL OR p.depth<>'0'
          ELSE p.parent_session_id IS NULL OR parent.session_id IS NULL OR p.depth::numeric<>parent.depth::numeric+1 END
        OR p.path_digest IS DISTINCT FROM CASE WHEN p.session_id=${root} THEN
          encode(sha256(convert_to(${namespace} || ':' || octet_length(convert_to(p.session_id,'UTF8'))::text || ':' || p.session_id || ':n','UTF8')),'hex')
        ELSE encode(sha256(convert_to(parent.path_digest || ':' || octet_length(convert_to(p.session_id,'UTF8'))::text || ':' || p.session_id || ':' ||
          octet_length(convert_to(p.parent_session_id,'UTF8'))::text || ':' || p.parent_session_id,'UTF8')),'hex') END)::text AS invalid,
      count(*) filter (where p.session_id=${root} AND p.parent_session_id IS NULL)::text AS roots,
      (SELECT count(*)::text FROM observability.development_native_sessions WHERE pass_key=${passKey}) AS sessions,
      (SELECT count(*)::text FROM observability.development_native_steps WHERE pass_key=${passKey}) AS steps,
      (SELECT count(*)::text FROM observability.development_native_steps step
        LEFT JOIN observability.development_native_paths path ON path.pass_key=step.pass_key AND path.session_id=step.document->>'sessionId'
        WHERE step.pass_key=${passKey} AND (path.session_id IS NULL OR path.parent_session_id IS DISTINCT FROM step.document->>'parentSessionId')) AS unmatched_steps
    FROM observability.development_native_paths p
    LEFT JOIN observability.development_native_sessions original ON original.pass_key=p.pass_key AND original.original_id=p.session_id
    LEFT JOIN observability.development_native_paths parent ON parent.pass_key=p.pass_key AND parent.session_id=p.parent_session_id
    WHERE p.pass_key=${passKey}`))[0]!;
  return row.paths === progress.counts.sessions && row.sessions === progress.counts.sessions && row.steps === progress.counts.steps &&
    row.invalid === '0' && row.roots === '1' && row.unmatched_steps === '0';
}
