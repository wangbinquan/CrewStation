import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { RuntimeDeletionOrigin } from '../../../domain/deletion/content';
import { DevelopmentParentEndingPointerSchema } from '../../../domain/development/parentEnding';
import { PROFILE_TEST_PROJECT_ID } from '../../../domain/profileTestEnvironment';
import { sameRuntimeScope } from './contentSources';
import type { RuntimeContentSources } from './contentSources';
import { RuntimeParentSources } from './parentSources';
import { runtimeObject, runtimeString } from './rowStore';
import type { RuntimeRawRow } from './rowStore';
import { runtimeCallbackFromRow } from './workHistory';
import type { RuntimeCallbackRow } from './workHistory';

const matches = (actual: unknown, expected: unknown) => {
  if (actual !== expected) throw precondition('运行环境原内容与原父记录关系不符');
};
async function legacyNative(sources: RuntimeContentSources, value: unknown, native: unknown) {
  const old = runtimeObject(value), current = runtimeObject(native);
  await sources.legacy('task', old['parentTaskId'], current['parentTaskId']);
  for (const [field, kind] of [['agentId', 'agent'], ['runnerId', 'runner'], ['terminalId', 'terminal']] as const)
    if (old[field] !== undefined || current[field] !== undefined) await sources.legacy(kind, old[field], current[field]);
}
async function environment(row: RuntimeRawRow, sources: RuntimeContentSources, parents: RuntimeParentSources) {
  const id = runtimeString(row['id']), facts = [await sources.task(id)];
  if (row['legacy_cluster'] !== null) {
    const legacy = runtimeObject(row['legacy_cluster']); await sources.legacy('task', legacy['taskId'], id);
    if (legacy['native'] !== undefined) await legacyNative(sources, legacy['native'], row['native']);
  }
  if (row['legacy_native'] !== null) await legacyNative(sources, row['legacy_native'], row['native']);
  if (row['rebuild_id'] !== null) facts.push(await parents.rebuild(runtimeString(row['rebuild_id'])));
  if (row['parent_ending'] !== null) {
    const pointer = DevelopmentParentEndingPointerSchema.parse(row['parent_ending']), ending = await parents.ending(pointer.endingId);
    matches(ending.epoch.parentId, id); matches(ending.row['epoch_hash'], pointer.epochHash); facts.push(ending.origin);
  }
  if (row['render'] !== null) {
    const render = runtimeObject(row['render']);
    if (Object.hasOwn(render, 'businessStorage')) {
      const expected = row['native'] === null ? id : runtimeObject(row['native'])['parentTaskId'];
      matches(runtimeObject(render['businessStorage'])['ownerTaskId'], expected);
    }
    if (Object.hasOwn(render, 'rebuild')) facts.push(await parents.rebuild(runtimeString(runtimeObject(render['rebuild'])['id'])));
  }
  return sameRuntimeScope(facts);
}
async function archive(row: RuntimeRawRow, sources: RuntimeContentSources, neverProvisioned: boolean) {
  const body = runtimeObject(row['body']), input = neverProvisioned ? runtimeObject(body['input']) : body;
  matches(input['taskId'], row['task_id']);
  if (!neverProvisioned) { matches(body['id'], row['id']); matches(body['state'], row['state']); }
  ResourceIdSchema.parse(input['operationId']);
  return sameRuntimeScope([await sources.task(runtimeString(row['task_id'])), await sources.root('project', runtimeString(input['projectId'])),
    await sources.root('service', runtimeString(input['serviceId']))]);
}
async function child(row: RuntimeRawRow, sources: RuntimeContentSources, parents: RuntimeParentSources) {
  const ending = await parents.ending(runtimeString(row['ending_id'])), snapshot = runtimeObject(row['snapshot']), native = runtimeObject(snapshot['native']);
  matches(snapshot['id'], row['child_id']); matches(snapshot['project_id'], ending.epoch.projectId); matches(snapshot['service_id'], ending.epoch.serviceId);
  matches(native['parentTaskId'], ending.epoch.parentId); matches(native['parentPodUid'] ?? null, row['original_parent_pod_uid']);
  matches(row['closed'], row['closure'] !== null);
  const current = await sources.rows.get('environments', runtimeString(row['child_id']));
  if (!current || current['native'] === null) throw precondition('运行环境原父成员的原执行记录缺失');
  for (const field of ['project_id', 'service_id', 'kind', 'namespace', 'pod_name', 'pvc_name']) matches(current[field], snapshot[field]);
  const currentNative = runtimeObject(current['native']);
  for (const field of ['parentTaskId', 'parentPodUid', 'pvcUid', 'nodeName', 'agentId', 'runnerId', 'terminalId', 'fingerprint', 'purpose']) matches(currentNative[field], native[field]);
  return sameRuntimeScope([ending.origin, await sources.task(runtimeString(row['child_id']))]);
}
export async function runtimeContentOwnership(table: string, row: RuntimeRawRow, sources: RuntimeContentSources) {
  const parents = new RuntimeParentSources(sources);
  let origin: RuntimeDeletionOrigin;
  switch (table) {
    case 'environments': origin = await environment(row, sources, parents); break;
    case 'admissions': {
      const project = ProjectIdSchema.parse(row['project_id']);
      if (typeof row['running'] !== 'number' || !Number.isSafeInteger(row['running']) || row['running'] < 0) throw precondition('运行环境原准入计数无效');
      origin = project === PROFILE_TEST_PROJECT_ID
        ? { complete: true, id: project, scope: 'platform', projectIds: [], revision: jsonHash({ platformAdmission: project }) }
        : await sources.root('project', project); break;
    }
    case 'environment_rebuilds': origin = await parents.rebuild(runtimeString(row['id'])); break;
    case 'blocked_admissions': origin = sameRuntimeScope([await sources.task(runtimeString(row['task_id'])), await sources.root('service', runtimeString(row['service_id']))]); break;
    case 'archive_executions': origin = await archive(row, sources, false); break;
    case 'unprovisioned_storage': origin = await archive(row, sources, true); break;
    case 'development_parent_endings': origin = (await parents.ending(runtimeString(row['id']))).origin; break;
    case 'development_parent_ending_children': origin = await child(row, sources, parents); break;
    case 'development_parent_ending_objects': origin = (await parents.ending(runtimeString(row['ending_id']))).origin; break;
    case 'development_parent_rebuild_claims': origin = sameRuntimeScope([(await parents.ending(runtimeString(row['source_ending_id']))).origin,
      await parents.rebuild(runtimeString(row['current_rebuild_id']))]); break;
    case 'original_callbacks': {
      const callback = runtimeCallbackFromRow(row as RuntimeCallbackRow), original = await sources.workOrigin(callback.originKind, callback.originKey);
      matches(original.id, callback.originId); matches(original.projectIds[0], callback.projectId); matches(original.revision, callback.originRevision);
      origin = sameRuntimeScope([original, await sources.root('project', callback.projectId)]); break;
    }
    default: throw precondition('运行环境内容表未登记');
  }
  return { origin, digest: jsonHash(origin) };
}
