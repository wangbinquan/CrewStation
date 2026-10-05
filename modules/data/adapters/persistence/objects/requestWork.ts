import { createHash, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ProjectId } from '@crewstation/contracts';
import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, newResourceId, precondition } from '@crewstation/kernel';
import type { Database, Executor } from '@crewstation/persistence';
import { assertSharedDatabaseAdmissionActive, withSharedDatabaseAdmissions } from '@crewstation/persistence';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ObjectRequestOrigin, ObjectRequestProcesses, ObjectRequestRunner } from '../../../ports/deletion/objectWork';
import type { ObjectByteLocation } from '../../../ports/objectStorage';
import { DATA_NATIVE_BLOCK_ADMISSION } from '../../../domain/deletionContents';

const uuid = z.string().uuid(), identity = z.string().min(1), decimal = z.string().regex(/^[0-9]+$/);
const processSchema = z.object({ podUid: uuid,containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),nodeUid: uuid,nodeName: identity,
  pid: z.number().int().positive(),startTicks: decimal,pidNamespace: decimal,bootId: uuid }).strict();
const originSchema = z.object({ projectId: ProjectIdSchema,serviceId: ResourceIdSchema,spaceId: ResourceIdSchema,attemptId: ResourceIdSchema,
  backendId: ResourceIdSchema,placementRevision: z.number().int().positive(),key: identity,size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();
const bodySchema = originSchema.extend({ process: processSchema }).strict();
const keyFor = (projectId: string) => 'data.project-admission:' + projectId;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function originalLocation(db: Executor, location: ObjectByteLocation): Promise<ObjectRequestOrigin> {
  const rows = await db.execute<{ body: unknown }>(sql`SELECT jsonb_build_object('projectId',s.project_id,'serviceId',s.service_id,'spaceId',a.space_id,'attemptId',a.id,'backendId',a.backend_id,'placementRevision',(a.body->>'placementRevision')::integer,'key',a.body->>'key','size',(a.body->>'size')::bigint) AS body
    FROM data.object_upload_attempts a INNER JOIN data.object_spaces s ON s.id=a.space_id
    WHERE a.backend_id=${location.backendId} AND a.body->>'key'=${location.key} AND a.body->>'placementRevision'=${String(location.placementRevision)}
    AND a.body->>'id'=a.id AND a.body->>'spaceId'=s.id AND a.body->>'uploadId'=a.upload_id AND a.body->>'backendId'=a.backend_id
    AND s.body->>'id'=s.id AND s.body->>'projectId'=s.project_id AND s.body->>'serviceId'=s.service_id
    AND EXISTS(SELECT 1 FROM data.object_uploads u WHERE u.id=a.upload_id AND u.space_id=a.space_id)
    AND EXISTS(SELECT 1 FROM data.object_backends b WHERE b.id=a.backend_id)`);
  if (rows.length !== 1) throw precondition('object byte request has no unique original attempt and space');
  const origin = originSchema.parse(rows[0]!.body);
  if (origin.key !== `spaces/${origin.spaceId}/attempts/${origin.attemptId}`) throw precondition('object byte request key is outside the original attempt');
  return origin;
}
async function assertOpen(db: Executor, projectId: ProjectId, available: (projectId: ProjectId) => Promise<void>) {
  if ((await db.execute(sql`SELECT project_id FROM data.project_deletions WHERE project_id=${projectId}`)).length) throw precondition('project object data is sealed for permanent deletion');
  await available(projectId);
}

/** A durable callback outlives a broken admission socket; only its private finally or positive original Pod stop ends it. */
export function objectRequestWork(input: { db: Database; processes: ObjectRequestProcesses; assertAvailable(projectId: ProjectId): Promise<void>; serviceProject(serviceId: string): Promise<ProjectId | undefined> }) {
  const { db } = input;
  const scopes = new AsyncLocalStorage<{ origin: ObjectRequestOrigin; kind: Parameters<ObjectRequestRunner['run']>[1]; active: boolean }>();
  const runner: ObjectRequestRunner = { run: async (location,kind,effect) => {
    const current = scopes.getStore();
    if (current?.active && current.kind === kind && current.origin.backendId === location.backendId && current.origin.placementRevision === location.placementRevision && current.origin.key === location.key) {
      assertSharedDatabaseAdmissionActive(db,keyFor(current.origin.projectId));
      return effect(current.origin);
    }
    const origin = await originalLocation(db,location);
    return withSharedDatabaseAdmissions(db,[keyFor(origin.projectId), DATA_NATIVE_BLOCK_ADMISSION],async guard => {
      await assertOpen(guard,origin.projectId,input.assertAvailable);
      if (await input.serviceProject(origin.serviceId) !== origin.projectId) throw precondition('object byte request service belongs to another project');
      const process = processSchema.parse(await input.processes.protectCurrent()), id = newResourceId(), exitKey = randomBytes(32).toString('hex');
      const body = { ...origin, process }, backend = (await guard.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`))[0]!;
      await db.transaction(async tx => {
        if (jsonHash(await originalLocation(tx,location)) !== jsonHash(origin)) throw precondition('object original location changed before admission');
        await assertOpen(tx,origin.projectId,input.assertAvailable);
        await tx.execute(sql`INSERT INTO data.object_work(id,project_id,kind,backend_pid,body,exit_key_hash) VALUES(${id},${origin.projectId},${kind},${backend.pid},${JSON.stringify(body)}::jsonb,${sha(exitKey)})`);
      });
      const scope = { origin,kind,active: true };
      try { assertSharedDatabaseAdmissionActive(db,keyFor(origin.projectId)); return await scopes.run(scope,() => effect(origin)); }
      finally {
        scope.active = false;
        await db.transaction(async tx => {
          await tx.execute(sql`SELECT set_config('crewstation.data_object_work_exit',${exitKey},true)`);
          await tx.execute(sql`UPDATE data.object_work SET state='finished',exit_digest=encode(sha256(convert_to(body::text,'UTF8')),'hex') WHERE id=${id} AND state='running'`);
        });
      }
    });
  } };
  return { ...runner, history: { read: (projectId: ProjectId) => db.transaction(tx => readHistory(tx,projectId), { isolationLevel: 'repeatable read',accessMode: 'read only' }) }, sweep: () => input.processes.sweep({
    stopped: async () => { throw precondition('individual container status cannot end an original object process'); },
    podStopped: (process,digest) => recoverStoppedRequests(db,process,digest),
    releasable: async uid => (await db.execute<{ pending: boolean }>(sql`SELECT EXISTS(SELECT 1 FROM data.object_work WHERE body->'process'->>'podUid'=${uid} AND state='running') AS pending`))[0]?.pending === false,
  }) };
}
async function recoverStoppedRequests(db: Database, process: { podUid: string; nodeUid: string; nodeName: string }, digest: string) {
  if (!uuid.safeParse(process.podUid).success || !uuid.safeParse(process.nodeUid).success || !process.nodeName || !/^[a-f0-9]{64}$/.test(digest)) throw precondition('object request original Pod stop proof is incomplete');
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT set_config('crewstation.data_object_work_recovery',${JSON.stringify({ ...process,digest })},true)`);
    await tx.execute(sql`UPDATE data.object_work SET state='finished',recovery_digest=${digest},exit_digest=encode(sha256(convert_to(body::text,'UTF8')),'hex') WHERE state='running' AND body->'process'->>'podUid'=${process.podUid} AND body->'process'->>'nodeUid'=${process.nodeUid} AND body->'process'->>'nodeName'=${process.nodeName}`);
  });
}
async function readHistory(db: Executor, projectId: ProjectId) {
  const records: { id: string; kind: 'put' | 'get' | 'verify' | 'remove' | 'inspect'; state: 'running' | 'finished'; origin: z.infer<typeof bodySchema>; exitDigest: string | null; recoveryDigest: string | null }[] = [];
  let after = '';
  for (;;) {
    const rows = await db.execute<{ id: string; kind: string; state: string; body: unknown; exit_digest: string | null; recovery_digest: string | null }>(sql`SELECT id,kind,state,body,exit_digest,recovery_digest FROM data.object_work WHERE project_id=${projectId} AND id>${after} ORDER BY id LIMIT 200`);
    if (!rows.length) break;
    for (const row of rows) {
      if (row.id <= after || !ResourceIdSchema.safeParse(row.id).success || !['put','get','verify','remove','inspect'].includes(row.kind) || !['running','finished'].includes(row.state)) throw precondition('object original request history is incomplete');
      const origin = bodySchema.parse(row.body);
      if (origin.projectId !== projectId || row.state === 'running' && row.exit_digest !== null || row.state === 'finished' && !/^[a-f0-9]{64}$/.test(row.exit_digest ?? '')) throw precondition('object original request history conflicts with its owner or exit');
      records.push({ id: row.id,kind: row.kind as typeof records[number]['kind'],state: row.state as typeof records[number]['state'],origin,exitDigest: row.exit_digest,recoveryDigest: row.recovery_digest });
      after = row.id;
    }
  }
  return { projectId,retainedRecordsComplete: true as const,revision: jsonHash(records),records };
}
