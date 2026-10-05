import type { ObjectRequestRunner } from '../../ports/deletion/objectWork';
import type { ObjectByteLocation } from '../../ports/objectStorage';

/** Admission covers owned metadata finalization as well as the original byte effect. */
export function runObjectHandler<T>(requests: ObjectRequestRunner | undefined, location: ObjectByteLocation, kind: Parameters<ObjectRequestRunner['run']>[1], effect: () => Promise<T>): Promise<T> {
  return requests ? requests.run(location,kind,effect) : effect();
}
