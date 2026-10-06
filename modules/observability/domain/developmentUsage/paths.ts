import { jsonHash, textHash } from '@crewstation/kernel';
import type { DevelopmentNativePassMetadata } from './metadata';

/** Stable for the same actual store/tree across before and final passes; no turn or page locator in the path identity. */
export function developmentNativePathNamespace(pass: DevelopmentNativePassMetadata): string {
  const source = pass.admission.identity;
  return jsonHash({ namespace: pass.selection.expectedNamespace, podUid: pass.registration.podUid,
    store: pass.preparation.store, nativeSource: source.nativeSource, sourceGeneration: source.sourceGeneration,
    epoch: source.epoch, rootSessionId: source.rootSessionId });
}
/** Lengths are UTF-8 byte lengths, so delimiters and non-ASCII identifiers have one unambiguous digest. */
export function developmentNativePathDigest(previous: string, id: string, parent: string | null): string {
  const segment = (value: string) => new TextEncoder().encode(value).byteLength + ':' + value;
  return textHash(previous + ':' + segment(id) + ':' + (parent === null ? 'n' : segment(parent)));
}
