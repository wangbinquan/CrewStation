import { z } from 'zod';
import type { SessionDeletionTransport } from '../../ports/projectDeletion';

const reply = z.strictObject({ exited: z.boolean() });
export type SessionDeletionRequest = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;
export function sessionDeletionTransport(address: string, local: SessionDeletionTransport['close'], request: SessionDeletionRequest = fetch): SessionDeletionTransport {
  return { close: async (context, birth) => {
    if (birth.replica === address) return local(context, birth);
    try {
      const response = await request(new URL('/internal/project-deletion/transports/' + birth.id, birth.replica), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(context), signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!response.ok) return false;
      return reply.parse(await response.json()).exited;
    } catch { return false; }
  } };
}
