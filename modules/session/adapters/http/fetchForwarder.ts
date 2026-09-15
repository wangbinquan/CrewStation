import { PlatformError } from '@crewstation/kernel';
import { ErrorEnvelopeSchema } from '@crewstation/contracts';
import { FORWARDED_HEADER } from '../../api/internalProtocol';
import type { CommandForwarder } from '../../ports/forwarding';
import { commandTimeout } from '../../domain/commandTimeout';

/** 副本间转发：只发到本副本不能处理的命令，带 x-cs-forwarded 防止环转。 */
export function fetchForwarder(fetchImpl: typeof fetch = fetch): CommandForwarder {
  return {
    forward: async (replica, taskId, command) => {
      const url = new URL(`${replica}/internal/tasks/${taskId}/commands`);
      const timeoutMs = (commandTimeout(command).timeoutMs ?? 30_000) + 5000;
      const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', [FORWARDED_HEADER]: '1' }, body: JSON.stringify(command), signal: AbortSignal.timeout(timeoutMs), ...(command.type === 'invokeApi' ? { keepalive: false, redirect: 'error' as const } : {}) });
      const body = (await res.json().catch(() => ({}))) as { payload?: unknown };
      if (!res.ok) {
        const failure = ErrorEnvelopeSchema.safeParse(body);
        if (failure.success) throw new PlatformError(failure.data.error, failure.data.message, failure.data.details);
        throw new PlatformError(res.status === 503 ? 'unavailable' : 'internal', `转发到 ${replica} 失败：${res.status}`);
      }
      return body.payload;
    },
  };
}
