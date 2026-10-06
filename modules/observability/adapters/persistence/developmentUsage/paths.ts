import { conflict, jsonHash } from '@crewstation/kernel';
import type { Executor } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import type { DevelopmentNativePassMetadata } from '../../../domain/developmentUsage/metadata';
import { developmentNativePathNamespace } from '../../../domain/developmentUsage/paths';
import type { DevelopmentNativePassProgress } from '../../../domain/developmentUsage/progress';

/** Constant-size parent proofs are retained in PG. No whole tree, ancestor array or depth bound enters JS. */
export async function qualifyDevelopmentNativePaths(db: Executor, taskKey: string, sourceId: string, passKey: string) {
  const pass = (await db.execute<{ document: DevelopmentNativePassMetadata; fingerprint: string; progress: DevelopmentNativePassProgress;
    task_key: string; source_id: string; state: string }>(sql`SELECT document,fingerprint,progress,task_key,source_id,state
    FROM observability.development_native_passes WHERE pass_key=${passKey} FOR UPDATE`))[0];
  if (!pass || pass.task_key !== taskKey || pass.source_id !== sourceId || jsonHash(pass.document) !== pass.fingerprint)
    throw conflict('原生父链必须属于原用量事务的同一任务和来源');
  if (pass.state !== 'source-eof' || !pass.progress.eof) return { state: 'source-pending' as const, issues: ['native-source-pending'] };
  const document = pass.document, root = document.admission.identity.rootSessionId;
  const namespace = developmentNativePathNamespace(document), projectId = document.registration.identity.projectId, taskId = document.registration.identity.taskId;
  // A reachable cycle is impossible with one immutable parent per id and a null-parent root.
  // Disconnected cycles, missing parents and other roots leave unmatched source population.
  const result = (await db.execute<{ reached: string; conflicts: string; roots: string; missing: string; step_conflicts: string }>(sql`
    WITH RECURSIVE links AS NOT MATERIALIZED (
      SELECT original_id AS id,document->>'parentSessionId' AS parent
      FROM observability.development_native_sessions WHERE pass_key=${passKey}
    ), graph(id,parent,depth,path_digest) AS (
      SELECT id,parent,0::numeric,encode(sha256(convert_to(${namespace} || ':' || octet_length(convert_to(id,'UTF8'))::text || ':' || id || ':n','UTF8')),'hex')
        FROM links WHERE id=${root} AND parent IS NULL
      UNION ALL
      SELECT child.original_id,child.document->>'parentSessionId',previous.depth+1,
        encode(sha256(convert_to(previous.path_digest || ':' || octet_length(convert_to(child.original_id,'UTF8'))::text || ':' || child.original_id || ':' ||
          octet_length(convert_to(child.document->>'parentSessionId','UTF8'))::text || ':' || (child.document->>'parentSessionId'),'UTF8')),'hex')
        FROM graph previous JOIN observability.development_native_sessions child
          ON child.pass_key=${passKey} AND child.document->>'parentSessionId'=previous.id
    ), inserted AS (
      INSERT INTO observability.development_native_paths(pass_key,session_id,parent_session_id,depth,path_digest,source_namespace,task_key,project_id,task_id)
        SELECT ${passKey},id,parent,depth::text,path_digest,${namespace},${taskKey},${projectId},${taskId} FROM graph
        ON CONFLICT(pass_key,session_id) DO NOTHING
        RETURNING session_id,parent_session_id,depth,path_digest,source_namespace
    ), retained AS (
      SELECT session_id,parent_session_id,depth,path_digest,source_namespace FROM observability.development_native_paths WHERE pass_key=${passKey}
      UNION ALL SELECT session_id,parent_session_id,depth,path_digest,source_namespace FROM inserted
    ) SELECT
      (SELECT count(*)::text FROM graph) AS reached,
      (SELECT count(*)::text FROM graph g LEFT JOIN retained r ON r.session_id=g.id
        WHERE r.session_id IS NULL OR r.parent_session_id IS DISTINCT FROM g.parent OR r.depth<>g.depth::text OR r.path_digest<>g.path_digest OR r.source_namespace<>${namespace}) AS conflicts,
      (SELECT count(*)::text FROM links WHERE id=${root} AND parent IS NULL) AS roots,
      (SELECT count(*)::text FROM links child WHERE child.parent IS NOT NULL AND NOT EXISTS(SELECT 1 FROM links parent WHERE parent.id=child.parent)) AS missing,
      (SELECT count(*)::text FROM observability.development_native_steps step LEFT JOIN links session ON session.id=step.document->>'sessionId'
        WHERE step.pass_key=${passKey} AND (session.id IS NULL OR session.parent IS DISTINCT FROM step.document->>'parentSessionId')) AS step_conflicts
  `))[0]!;
  const issues = [
    ...(result.roots !== '1' ? ['native-root-missing'] : []),
    ...(result.missing !== '0' ? ['native-parent-missing'] : []),
    ...(result.reached !== pass.progress.counts.sessions && result.missing === '0' && result.roots === '1' ? ['native-parent-cycle-or-other-root'] : []),
    ...(result.conflicts !== '0' ? ['native-parent-reference-conflict'] : []),
    ...(result.step_conflicts !== '0' ? ['native-step-parent-conflict'] : []),
  ];
  return { state: issues.length ? 'incomplete' as const : 'complete' as const, issues,
    sessions: result.reached, sourceNamespace: namespace };
}
