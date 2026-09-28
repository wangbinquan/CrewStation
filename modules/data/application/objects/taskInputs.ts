import { createHash, createHmac } from 'node:crypto';
import { jsonHash, notFound } from '@crewstation/kernel';
import type { TaskInputApi, TaskInputCaller } from '../../api/taskInputApi';
import type { TaskInputRepository } from '../../ports/taskInputs';
import { downloadStoredObject, type ObjectDownloadDeps } from '../objectDownload';

export function taskInputUseCases(deps: ObjectDownloadDeps & { inputs: TaskInputRepository; secretKeyBase64: string; apiUrl: string }): TaskInputApi {
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const scope = (caller: TaskInputCaller) => deps.inputs.authenticate(caller.id, hash(caller.token), caller.podUid);
  return {
    prepare: deps.inputs.prepare, commit: deps.inputs.commit, abort: deps.inputs.abort, bind: deps.inputs.bind,
    environment: async (input) => {
      const token = createHmac('sha256', Buffer.from(deps.secretKeyBase64, 'base64')).update(`task-input-v1:${jsonHash(input)}`).digest('base64url');
      await deps.inputs.issue(input.taskId, input.generation, input.consumerId, hash(token));
      return { CS_OBJECT_INPUT_URL: `${deps.apiUrl.replace(/\/$/, '')}/internal/task-inputs/${input.consumerId}`, CS_OBJECT_INPUT_TOKEN: token };
    },
    manifest: async (caller) => { const { record } = await scope(caller); return { completed: !!record.completedAt, items: record.completedAt ? [] : record.items }; },
    download: async (caller, objectId, signal) => {
      const { record, source } = await scope(caller);
      if (record.completedAt || !record.items.some((item) => item.objectId === objectId)) throw notFound('任务输入对象');
      return downloadStoredObject(deps, objectId, source, { signal });
    },
    complete: (caller) => deps.inputs.complete(caller.id, hash(caller.token), caller.podUid),
  };
}
