import type { DevelopmentUsageDrainReason, DevelopmentUsageLookup, DevelopmentUsageKey, DevelopmentUsageLoss, DevelopmentUsageRegistration, StoredDevelopmentUsage, TaskId } from '@crewstation/contracts';
import { DevelopmentUsageLookupSchema, TaskIdSchema, StoredDevelopmentUsageSchema } from '@crewstation/contracts';

export interface DevelopmentUsageSessionClient {
  lookupDevelopmentUsage(taskId: TaskId): Promise<DevelopmentUsageLookup>;
  registerDevelopmentUsage(registration: DevelopmentUsageRegistration): Promise<StoredDevelopmentUsage>;
  getDevelopmentUsage(taskId: TaskId, key: DevelopmentUsageKey): Promise<StoredDevelopmentUsage>;
  requestDevelopmentUsageDrain(taskId: TaskId, key: DevelopmentUsageKey, reason: DevelopmentUsageDrainReason): Promise<StoredDevelopmentUsage>;
  markDevelopmentUsageUnavailable(taskId: TaskId, loss: DevelopmentUsageLoss): Promise<StoredDevelopmentUsage>;
}
export function developmentUsageClient(call: <T>(path: string, init?: RequestInit) => Promise<T>): DevelopmentUsageSessionClient {
  const request = async (path: string, value: unknown) => StoredDevelopmentUsageSchema.parse(await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }));
  const base = (taskId: TaskId) => `/internal/tasks/${taskId}/development-usage`;
  return {
    lookupDevelopmentUsage: async (rawTaskId) => {
      const taskId = TaskIdSchema.parse(rawTaskId);
      const found = DevelopmentUsageLookupSchema.parse(await call(`${base(taskId)}/registration`, { method: 'GET' }));
      if (found.runtimeTaskId !== taskId) throw new Error('Session lookup returned another execution');
      return found;
    },
    registerDevelopmentUsage: (registration) => request('/internal/development-usage/register', registration),
    getDevelopmentUsage: (taskId, key) => request(`${base(taskId)}/read`, key),
    requestDevelopmentUsageDrain: (taskId, key, reason) => request(`${base(taskId)}/drain`, { key, reason }),
    markDevelopmentUsageUnavailable: (taskId, loss) => request(`${base(taskId)}/unavailable`, loss),
  };
}
