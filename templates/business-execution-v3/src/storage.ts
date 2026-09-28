import { Platform, PlatformError, type Fence, type Task } from './client';
import { exportLogPage, type LogStore } from './storageLog';

interface Plan { id: string; state: string; revision: number; digest: string | null }
interface Upload { id: string; state: string; objectId: string | null }
/** The injected CS_OBJECTS_URL already ends in /v3/objects. JSON and byte deadlines are separate. */
export class Objects extends Platform {
  constructor(private readonly endpoint: string, private readonly byteFetch: typeof fetch = fetch) { super(endpoint, byteFetch); }
  async put(id: string, payload: string, fence: Fence): Promise<void> {
    const response = await this.byteFetch(`${this.endpoint.replace(/\/$/, '')}/uploads/${id}/content`, {
      method: 'PUT', body: new Blob([payload]).stream(), headers: { 'content-type': 'application/octet-stream', 'content-length': String(Buffer.byteLength(payload)), 'x-cs-object-fence': JSON.stringify(fence) },
      signal: AbortSignal.timeout(1800_000), redirect: 'error',
    });
    if (!response.ok) throw new PlatformError(response.status, await response.json());
    await response.body?.cancel();
  }
  async persist(key: string, payload: string, sha256: string, taskId: string, fence: Fence): Promise<string> {
    let upload = await this.call<Upload>('/uploads', { requestKey: key, name: `${key}.ndjson`, size: Buffer.byteLength(payload), sha256, mediaType: 'application/x-ndjson', fence });
    // A lost PUT response is resolved by reading this durable upload, never by blindly sending its bytes again.
    if (upload.state === 'waiting') await this.put(upload.id, payload, fence);
    if (upload.state !== 'ready') upload = await this.call<Upload>(`/uploads/${upload.id}/commit`, { requestKey: `${key}:commit`, fence });
    if (upload.state !== 'ready' || !upload.objectId) throw new PlatformError(503, { error: 'log_object_pending', uploadId: upload.id, state: upload.state });
    const response = await this.byteFetch(`${this.endpoint.replace(/\/$/, '')}/${upload.objectId}/references`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestKey: `${key}:pin`, ownerType: 'application', ownerId: taskId, revision: 1, fence }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new PlatformError(response.status, await response.json());
    return upload.objectId;
  }
  async unpin(objectId: string, taskId: string, key: string, fence: Fence): Promise<void> {
    const response = await this.byteFetch(`${this.endpoint.replace(/\/$/, '')}/${objectId}/references`, { method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestKey: key, ownerType: 'application', ownerId: taskId, revision: 1, fence }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new PlatformError(response.status, await response.json());
    await response.body?.cancel();
  }
}

/** Optional RFC-035 path; the original legacy command/close journey is unchanged. */
export async function storageAction(platform: Platform, objects: Objects | undefined, logs: LogStore, input: Record<string, unknown>, fence: Fence): Promise<unknown> {
  if (!objects) throw new Error('先在 Manifest 声明 spec.data.objects 并提供 CS_OBJECTS_URL');
  const requestKey = String(input.requestKey), action = String(input.action);
  if (action === 'storage-command') {
    const capabilities = await platform.call<{ storage?: { finalization: boolean; taskInputs: boolean } }>('/v3/business-execution/capabilities');
    if (!capabilities.storage?.finalization || (input.inputObjects && !capabilities.storage.taskInputs)) throw new Error('平台未开放对象终结或任务输入能力');
    const task = await platform.call<Task>('/v3/business-tasks', { requestKey: `${requestKey}:parent`, taskContractVersion: 'sample-v1', volumeMode: 'persistent', completionPolicy: 'archive-and-delete', fence, ...(input.inputObjects ? { inputObjects: input.inputObjects } : {}) });
    const child = await platform.call(`/v3/business-tasks/${task.id}/subtasks`, { kind: 'command', requestKey: `${requestKey}:command`, name: 'archive-proof', argv: ['sh', '-c', 'printf preserved > /work/proof.txt; printf "archive-ready\\n"'], env: {}, timeoutSeconds: 120, fence });
    return { task, child };
  }
  const taskId = String(input.taskId);
  if (!/^[a-f0-9-]{36}$/.test(taskId)) throw new Error('任务 ID 无效');
  if (action === 'storage-log-page') return exportLogPage(platform, objects, logs, { taskId, requestKey, after: typeof input.after === 'string' ? input.after : null }, fence);
  if (action !== 'storage-finalize') throw new Error('未知存储动作');
  // Freeze the manifest in the application DB before calling the platform. Replays never add a newer log page.
  const saved = await logs.finalManifest(requestKey, taskId, fence);
  let plan = await objects.call<Plan>(`/tasks/${taskId}/archive-plans`, { requestKey: `${requestKey}:plan`, fence });
  if (plan.state === 'draft') {
    for (let page = 0; page * 100 < saved.length; page++) plan = await objects.call<Plan>(`/archive-plans/${plan.id}/pages`, { requestKey: `${requestKey}:page:${page}`, expectedRevision: page + 1, page, entries: saved.slice(page * 100, (page + 1) * 100), fence });
    plan = await objects.call<Plan>(`/archive-plans/${plan.id}/seal`, { requestKey: `${requestKey}:seal`, expectedRevision: plan.revision, fence });
  }
  if (!plan.digest) throw new Error('归档清单尚未封存');
  // Sealed plans now own pending references; release only this application's temporary pins.
  for (const entry of saved) if (entry.kind === 'object') await objects.unpin(entry.objectId, taskId, `${requestKey}:unpin:${entry.objectId}`, fence);
  return platform.call(`/v3/business-tasks/${taskId}/finalize`, { requestKey, expectedGeneration: input.expectedGeneration, outcome: 'succeeded', archive: { planId: plan.id, planRevision: plan.revision, digest: plan.digest }, fence });
}
