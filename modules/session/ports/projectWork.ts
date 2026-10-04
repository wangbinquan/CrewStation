import type { ProjectDeletionContext } from '@crewstation/contracts';
import type { SessionWorkInput } from '../domain/deletion/work';

export interface SessionWorkHandle {
  check(): Promise<void>;
  /** 已发 I/O 一直保留到真实 finally，即使外层驱动或 HTTP 请求先报错。 */
  retain<T>(effect: () => Promise<T>): Promise<T>;
}
export type SessionWorkTracker = <T>(callback: () => Promise<T>) => Promise<T>;
export interface SessionProjectWork {
  run<T>(input: SessionWorkInput, callback: (handle: SessionWorkHandle) => Promise<T>, track?: SessionWorkTracker): Promise<T>;
  runGranted<T>(context: ProjectDeletionContext, input: SessionWorkInput, callback: (handle: SessionWorkHandle) => Promise<T>, track?: SessionWorkTracker): Promise<T>;
  drain(): Promise<void>;
}
