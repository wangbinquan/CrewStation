import { PlatformError } from '@crewstation/kernel';
import type { ObjectEndpointConfig } from '../../ports/objectPlane';
import { objectEndpointUrl, signObjectRequest } from './s3Signing';

/** A read-only availability probe; provisioning separately verifies bucket write permissions. */
export async function probeObjectBucket(config: ObjectEndpointConfig, signal: AbortSignal): Promise<void> {
  const url = objectEndpointUrl(config.endpoint, config.bucket);
  const response = await fetch(url, { method: 'HEAD', headers: signObjectRequest({ url, method: 'HEAD', ...config }), signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' });
  await response.body?.cancel();
  if (response.status !== 200) throw new PlatformError('unavailable', '对象 bucket 不可访问', { status: response.status });
}
