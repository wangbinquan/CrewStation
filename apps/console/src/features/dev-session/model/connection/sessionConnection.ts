import type { DevSessionDto } from '@crewstation/contracts';
import type { StreamState } from '../taskStreamSocket';

/** 生命周期与握手拒绝优先；页面通道可回放，不等于工作容器可接受命令。 */
export function sessionConnection(session: DevSessionDto, stream: StreamState) {
  if (session.rebuild && ['queued', 'replacing', 'starting'].includes(session.rebuild.state)) return 'recovering';
  if (session.state === 'failed') return 'failed';
  if (session.state === 'releasing' || session.state === 'released') return 'releasing';
  if (session.connectionIssue) return 'protocol';
  if (session.state === 'creating') return 'starting';
  if (stream.status !== 'open') return 'browser';
  if (!stream.runnerConnected) return 'unknown';
  if (stream.runnerState && stream.runnerState !== 'ready') return 'stopping';
  return 'ready';
}
