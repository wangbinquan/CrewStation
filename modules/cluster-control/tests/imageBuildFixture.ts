import type { RuntimeImageBuildRender } from '@crewstation/contracts';
import { newResourceId } from '@crewstation/kernel';

export function imageBuildPlan(): RuntimeImageBuildRender {
  return { buildId: newResourceId(), resourceId: newResourceId(), executionEpoch: 1, projectId: newResourceId(), projectSlug: 'image-demo', namespace: 'cs-image-demo', name: 'image-build-1', secret: 'image-build-1-secret', architecture: 'linux/amd64', clientImage: 'builder-client:fixed', builderImage: 'buildkit:fixed-rootless', repository: 'registry.internal:5000/runtime/projects/p1/build/image', destination: 'registry.test/runtime/projects/p1/build/image:artifact', checkoutCommand: ['sh', '-c', 'checkout'], clientCommand: ['sh', '-c', 'build'], daemonCommand: ['sh', '-c', 'daemon'], secretIds: ['npm'], builderResources: { cpu: '2', memory: '4Gi', ephemeralStorage: '8Gi' }, clientResources: { cpu: '500m', memory: '512Mi', ephemeralStorage: '2Gi' }, workspaceSize: '2Gi', cacheSize: '8Gi', activeDeadlineSeconds: 1800, ttlSecondsAfterFinished: 3600 };
}
