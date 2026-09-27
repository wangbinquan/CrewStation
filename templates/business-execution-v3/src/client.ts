/** Standalone template: no workspace imports and no model credentials in the service slot. */
export class PlatformError extends Error {
  constructor(readonly status: number, readonly body: unknown) { super(`平台请求失败 (${status})`); }
}
export class Platform {
  constructor(private readonly base: string, private readonly fetcher: typeof fetch = fetch) {}
  async call<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.base.replace(/\/$/, '')}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    const data: unknown = await response.json();
    if (!response.ok) throw new PlatformError(response.status, data);
    return data as T;
  }
}
export interface Fence { epoch: number; leaseId: string; instanceId: string }
export interface Control {
  epoch: number; phase: 'inactive' | 'frozen' | 'preparing' | 'active'; activeReleaseId: string | null;
  physicalSlot: 'blue' | 'green' | null; leaseOwner: string | null; leaseId?: string; leaseExpiresAt: string | null;
  operationId?: string; migration?: { operationId: string; targetReleaseId: string; applicationReady: boolean };
}
export interface Task { id: string; state: string; generation: number }
export interface Subtask { id: string; state: string; attempt: number; executionId: string; result?: { finalCursor: string } }
