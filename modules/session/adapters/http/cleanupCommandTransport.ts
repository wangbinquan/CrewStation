import type { ProjectDeletionContext, RunnerCommand } from '@crewstation/contracts';
import { PlatformError } from '@crewstation/kernel';
import type { SessionConnectionBirth } from '../../ports/projectDeletion';
import type { SessionDeletionRequest } from './deletionTransport';

export function sessionCleanupCommandTransport(address: string,
  local: (context: ProjectDeletionContext, consumerId: string, command: RunnerCommand) => Promise<unknown>, request: SessionDeletionRequest = fetch) {
  return async (context: ProjectDeletionContext, birth: SessionConnectionBirth, command: RunnerCommand): Promise<unknown> => {
    if (birth.replica === address) return local(context, birth.id, command);
    const response = await request(new URL('/internal/project-deletion/commands/' + birth.id, birth.replica), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context, command }),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    if (!response.ok) throw new PlatformError('unavailable', '原 Session 副本未完成私有清理命令', { status: response.status });
    return (await response.json() as { payload: unknown }).payload;
  };
}
