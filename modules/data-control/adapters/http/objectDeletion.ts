import { precondition } from '@crewstation/kernel';
import type { ObjectEndpointConfig, ObjectLocation } from '../../ports/objectPlane';
import { objectEndpointUrl, signObjectRequest } from './s3Signing';

/** Native IDs come from the independently retained Garage inventory. The root
 * supplies a fresh durable grant before each private abort/delete effect. */
export function objectDeletionTransport(resolve: (location: Pick<ObjectLocation, 'backendId' | 'placementRevision'>) => Promise<ObjectEndpointConfig>, fetcher: (url: URL, init: RequestInit) => Promise<Response> = fetch) {
  const remove = async (location: ObjectLocation, uploadId: string | undefined, signal: AbortSignal, authorize: () => Promise<void>) => {
    const original = { ...location };
    if (uploadId !== undefined && !/^[a-f0-9]{64}$/.test(uploadId)) throw precondition('原 multipart upload 身份无效');
    const config = await resolve({ backendId: original.backendId, placementRevision: original.placementRevision }), url = objectEndpointUrl(config.endpoint, config.bucket, original.key);
    if (uploadId !== undefined) url.searchParams.set('uploadId', uploadId);
    const headers = signObjectRequest({ url, method: 'DELETE', ...config });
    await authorize(); signal.throwIfAborted();
    const response = await fetcher(url, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
    await response.body?.cancel(); await authorize();
    if (![200, 204, 404].includes(response.status)) throw precondition('原对象删除或 multipart 中止尚未确认', { code: 'object_native_deletion_unavailable' });
    // An HTTP acknowledgement is never a physical completion receipt. The
    // native metadata, pending queues, every original copy and consumers are
    // observed independently by the data owner's physical source afterwards.
  };
  return { location: async (location: Pick<ObjectLocation, 'backendId' | 'placementRevision'>) => {
    const config = await resolve({ backendId: location.backendId, placementRevision: location.placementRevision }); objectEndpointUrl(config.endpoint, config.bucket);
    return { endpoint: config.endpoint, bucket: config.bucket, region: config.region };
  }, remove: (location: ObjectLocation, signal: AbortSignal, authorize: () => Promise<void>) => remove(location, undefined, signal, authorize),
    abort: (location: ObjectLocation, uploadId: string, signal: AbortSignal, authorize: () => Promise<void>) => remove(location, uploadId, signal, authorize) };
}
