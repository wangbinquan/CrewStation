import { isPlatformError, jsonHash, newResourceId } from '@crewstation/kernel';
import type { RuntimeProjectWork } from '../../ports/deletion/work';
import type { RuntimeWorkInput } from '../../domain/deletion/work';

/** Per-original scopes let an unrelated project continue after another project's admission is closed. */
export async function runtimeBackground<T>(work: RuntimeProjectWork | undefined, kind: RuntimeWorkInput['kind'], originKind: RuntimeWorkInput['originKind'], originKey: string, callback: () => Promise<T>, closed: T, identity?: unknown): Promise<T> {
  if (!work) return callback();
  try { return await work.runOrigin({ originKind, originKey, kind, reference: newResourceId(), inputDigest: jsonHash({ kind, originKind, originKey, identity }) }, callback); }
  catch (error) {
    if (isPlatformError(error) && ['runtime_project_admission_closed', 'project_deletion_admission_closed'].includes(String(error.details.code))) return closed;
    throw error;
  }
}
