import { ProjectIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { jsonHash, precondition } from '@crewstation/kernel';
import type { RuntimeDeletionOrigin } from '../../../domain/deletion/content';
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
    case 'original_callbacks': {
      const callback = runtimeCallbackFromRow(row as RuntimeCallbackRow), original = await sources.workOrigin(callback.originKind, callback.originKey);
      matches(original.id, callback.originId); matches(original.projectIds[0], callback.projectId); matches(original.revision, callback.originRevision);
      origin = sameRuntimeScope([original, await sources.root('project', callback.projectId)]); break;
    }
    default: throw precondition('运行环境内容表未登记');
  }
  return { origin, digest: jsonHash(origin) };
}
