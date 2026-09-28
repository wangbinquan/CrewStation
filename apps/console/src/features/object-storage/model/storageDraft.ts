import type { ObjectBackendDto, ObjectStoragePlanDto } from '@crewstation/contracts';
import { ObjectStoragePlanInputSchema, RegisterObjectBackendSchema, UpdateObjectBackendSchema } from '@crewstation/contracts';

export interface BackendDraft {
  requestKey: string; name: string; endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string;
  monitoringEndpoint: string; monitoringToken: string; durability: string; budgetGiB: string; state: string;
}
export const backendDraft = (original?: ObjectBackendDto): BackendDraft => ({ requestKey: crypto.randomUUID(), name: original?.name ?? '',
  endpoint: original?.endpoint ?? '', region: original?.region ?? 'garage', bucket: original?.bucket ?? '', accessKeyId: '', secretAccessKey: '',
  monitoringEndpoint: '', monitoringToken: '', durability: original?.durability ?? 'dev-only', budgetGiB: String((original?.budgetBytes ?? 60 * 1024 ** 3) / 1024 ** 3), state: original?.state ?? 'active' });
export function backendRegistration(draft: BackendDraft) {
  return RegisterObjectBackendSchema.parse({ requestKey: draft.requestKey, name: draft.name, endpoint: draft.endpoint, region: draft.region,
    bucket: draft.bucket, accessKeyId: draft.accessKeyId, secretAccessKey: draft.secretAccessKey, durability: draft.durability, budgetBytes: Number(draft.budgetGiB) * 1024 ** 3,
    ...(draft.monitoringEndpoint || draft.monitoringToken ? { monitoring: { endpoint: draft.monitoringEndpoint, token: draft.monitoringToken } } : {}) });
}
export function backendUpdate(draft: BackendDraft, original: ObjectBackendDto) {
  return UpdateObjectBackendSchema.parse({ expectedRevision: original.revision, name: draft.name, state: draft.state, budgetBytes: Number(draft.budgetGiB) * 1024 ** 3 });
}
export interface PlanDraft { name: string; backendId: string; quotaGiB: string; objectMiB: string; transfers: string; enabled: boolean }
export const planDraft = (original?: ObjectStoragePlanDto, backendId = ''): PlanDraft => ({ name: original?.name ?? '', backendId: original?.backendId ?? backendId,
  quotaGiB: String((original?.quotaBytes ?? 20 * 1024 ** 3) / 1024 ** 3), objectMiB: String((original?.maxObjectBytes ?? 1024 ** 3) / 1024 ** 2),
  transfers: String(original?.maxConcurrentTransfers ?? 4), enabled: original?.enabled ?? true });
export function planInput(draft: PlanDraft) {
  return ObjectStoragePlanInputSchema.parse({ name: draft.name, backendId: draft.backendId, quotaBytes: Number(draft.quotaGiB) * 1024 ** 3,
    maxObjectBytes: Number(draft.objectMiB) * 1024 ** 2, maxConcurrentTransfers: Number(draft.transfers), enabled: draft.enabled });
}
