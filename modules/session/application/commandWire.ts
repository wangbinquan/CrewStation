import type { RunnerCommand } from '@crewstation/contracts';
import { PlatformError, precondition } from '@crewstation/kernel';
import type { Clock } from '@crewstation/kernel';
import type { RunnerConnection } from '../domain/runnerConnection';
import { commandTimeout } from '../domain/commandTimeout';

/** Both ordinary commands and private cleanup retain the original connection through the real reply. */
export async function sendRunnerWire(connection: RunnerConnection, command: RunnerCommand, clock: Clock, original: () => boolean): Promise<unknown> {
  const check = () => { if (connection.closed || !original()) throw precondition('原 Runner 连接已退出，不能继续发送命令'); };
  check(); const wire = connection.legacy ? await connection.legacy.outgoing(command) : command; check();
  return new Promise<unknown>((resolve, reject) => {
    connection.pending.add({ id: command.id, type: command.type, sentAt: clock.now().getTime(), resolve, ...commandTimeout(command),
      reject: (error) => reject(new PlatformError(error.code === 'timeout' ? 'unavailable' : 'precondition', error.message, { code: error.code })),
    });
    try { connection.socket.send(JSON.stringify(wire)); }
    catch (error) { connection.pending.settle(command.id, { ok: false, code: 'send_failed', message: String(error) }); }
  });
}
