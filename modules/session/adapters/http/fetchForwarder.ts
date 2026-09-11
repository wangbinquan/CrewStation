import { PlatformError } from '@crewstation/kernel';
import { FORWARDED_HEADER } from '../../api/internalProtocol';
import type { CommandForwarder } from '../../ports/forwarding';

/** 副本间转发：只发到本副本不能处理的命令，带 x-cs-forwarded 防止环转。 */
export function fetchForwarder(fetchImpl: typeof fetch = fetch): CommandForwarder {
  return {
    forward: async (replica, taskId, command) => {
      const res = await fetchImpl(`${replica}/internal/tasks/${taskId}/commands`, { method: 'POST', headers: { 'content-type': 'application/json', [FORWARDED_HEADER]: '1' }, body: JSON.stringify(command) });
      const body = (await res.json().catch(() => ({}))) as { payload?: unknown; error?: string; message?: string };
      if (!res.ok) throw new PlatformError(res.status === 503 ? 'unavailable' : 'internal', body.message ?? `转发到 ${replica} 失败：${res.status}`);
      return body.payload;
    },
  };
}
