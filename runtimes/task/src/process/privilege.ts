/**
 * 降权策略：TaskRunner 以 root 运行时，每个 Agent／终端／exec／预览子进程都经 util-linux 的 setpriv 切到 worker 身份，
 * 于是 TaskRunner 自己的 UID 与任何 Agent 进程都不同（Design §5.6 的隔离设计）；非 root 时直接拉起并明确记录隔离关闭。
 */
export interface Isolation {
  readonly enabled: boolean;
  readonly uid: number;
  readonly gid: number;
  /** 未启用时的原因，用于日志。 */
  readonly reason?: string;
  wrap(cmd: string[]): string[];
}

export interface IsolationProbe {
  uid: number;
  gid: number;
  currentUid: number | undefined;
  which: (binary: string) => string | null;
}

export class IsolationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsolationUnavailableError';
  }
}

export function resolveIsolation(probe: IsolationProbe): Isolation {
  const passthrough = (cmd: string[]): string[] => cmd;
  if (probe.currentUid === undefined) return { enabled: false, uid: probe.uid, gid: probe.gid, reason: '平台不提供 getuid', wrap: passthrough };
  if (probe.currentUid !== 0) return { enabled: false, uid: probe.uid, gid: probe.gid, reason: `以非 root 用户（uid ${probe.currentUid}）运行`, wrap: passthrough };
  if (probe.uid === 0) throw new IsolationUnavailableError('以 root 运行时 worker uid 不能为 0');
  const setpriv = probe.which('setpriv');
  if (setpriv === null) throw new IsolationUnavailableError('以 root 运行但找不到 setpriv（util-linux），拒绝在无隔离的情况下拉起子进程');
  const prefix = [setpriv, '--reuid', String(probe.uid), '--regid', String(probe.gid), '--clear-groups', '--'];
  return { enabled: true, uid: probe.uid, gid: probe.gid, wrap: (cmd) => [...prefix, ...cmd] };
}

export function probeCurrentUid(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}
