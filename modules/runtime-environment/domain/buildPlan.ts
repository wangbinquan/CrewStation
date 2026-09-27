import { RuntimeImageBuildRenderSchema } from '@crewstation/contracts';
import { precondition } from '@crewstation/kernel';
import type { ImageBuild, ImageRevision } from './records';
import { imageCheckoutScript, imageClientScript, imageDaemonScript } from './buildScripts';
import { inlineContextScript } from './inlineContext';

export interface RuntimeImageBuilderSettings {
  readonly clientImage: string; readonly builderImage: string;
  readonly registryBase: string; readonly pushHost: string; readonly pushInsecure: boolean;
  readonly builderResources: { cpu: string; memory: string; ephemeralStorage: string };
  readonly clientResources: { cpu: string; memory: string; ephemeralStorage: string };
  readonly workspaceSize: string; readonly cacheSize: string;
}
export function runtimeImageBuildPlan(build: ImageBuild, revision: ImageRevision, project: { namespace: string; slug: string; repositoryUrl: string }, settings: RuntimeImageBuilderSettings, now: Date) {
  if (revision.source.kind === 'existing' || !build.resourceId) throw precondition('只有新镜像构建需要 builder');
  const path = build.projectId ? `runtime/projects/${build.projectId}/${build.id}/image` : `runtime/platform/${build.id}/image`, repository = `${settings.registryBase}/${path}`, destination = `${settings.pushHost}/${path}:artifact`;
  const clientRevision = revision.baseImage?.startsWith(`${settings.registryBase}/`) ? { ...revision, baseImage: `${settings.pushHost}/${revision.baseImage.slice(settings.registryBase.length + 1)}` } : revision;
  return RuntimeImageBuildRenderSchema.parse({
    buildId: build.id, resourceId: build.resourceId, executionEpoch: build.executionEpoch, projectId: build.projectId, projectSlug: project.slug,
    namespace: project.namespace, name: `image-${build.id}`, secret: `image-${build.id}-auth`, architecture: revision.source.architecture,
    clientImage: settings.clientImage, builderImage: settings.builderImage, repository, destination,
    checkoutCommand: ['sh', '-ec', revision.source.kind === 'inline' ? inlineContextScript(revision) : imageCheckoutScript(project.repositoryUrl, revision)], clientCommand: ['sh', '-ec', imageClientScript(clientRevision, destination, settings.pushInsecure)], daemonCommand: ['sh', '-ec', imageDaemonScript(settings.pushHost, settings.pushInsecure)],
    ...(revision.source.kind === 'inline' ? { inlineFileCount: revision.source.files.length } : {}),
    secretIds: revision.source.kind === 'source' ? revision.source.secrets.map((s) => s.id) : [], builderResources: settings.builderResources, clientResources: settings.clientResources,
    workspaceSize: settings.workspaceSize, cacheSize: settings.cacheSize, activeDeadlineSeconds: Math.max(1, Math.ceil((Date.parse(build.deadline) - now.getTime()) / 1000)), ttlSecondsAfterFinished: 86400,
  });
}
