import type { Actor, RuntimeImageSource } from '@crewstation/contracts';
import { RuntimeImageSourceSchema } from '@crewstation/contracts';
import { precondition, validation } from '@crewstation/kernel';
import { inspectRuntimeDockerfile } from '../domain/dockerfilePolicy';
import { inspectSourceLink, inspectSourceTree } from '../domain/sourceTree';
import type { ExistingImageResolver, ImageBuildBase, ImageSourceRepository } from '../ports/sourceRepository';
import type { RuntimeImageSourceResolver } from '../ports/platform';

export function runtimeImageSourcePreparation(repository: ImageSourceRepository, bases: ImageBuildBase, images: ExistingImageResolver): RuntimeImageSourceResolver {
  return {
    prepare: async (actor: Actor, projectId: string, input: RuntimeImageSource) => {
      const source = RuntimeImageSourceSchema.parse(input);
      if (source.kind === 'existing') {
        const reference = await images.resolve(actor, projectId, source.reference, source.architecture), baseImage = await bases.resolve(actor, projectId, source);
        if (source.usage !== 'service' && (!baseImage || !/@sha256:[0-9a-f]{64}$/.test(baseImage))) throw precondition('平台任务或 Agent 底座未固定摘要');
        return { source: { ...source, reference }, ...(baseImage ? { baseImage } : {}) };
      }
      const { commitSha, tree } = await repository.resolve(actor, projectId, source.repositoryBindingId, source.ref);
      if (!/^[0-9a-f]{40,64}$/.test(commitSha)) throw precondition('源码未解析到固定提交');
      const { dockerfilePath, links, attributes } = inspectSourceTree(tree, source.context, source.dockerfile);
      for (const entry of links) inspectSourceLink(entry.path, (await repository.readFile(source.repositoryBindingId, commitSha, entry.path)) ?? '', source.context);
      for (const entry of attributes) {
        const text = await repository.readFile(source.repositoryBindingId, commitSha, entry.path);
        if (text && /\bfilter\s*=\s*lfs\b/.test(text)) throw validation('首版运行镜像构建不支持 Git LFS，请将构建需要的实际文件纳入源码');
      }
      const dockerfile = await repository.readFile(source.repositoryBindingId, commitSha, dockerfilePath);
      if (dockerfile === undefined) throw validation('固定提交中没有 Dockerfile');
      inspectRuntimeDockerfile(dockerfile, source);
      if (source.baseProfile && source.usage !== 'agent') throw validation('只有 Agent 用途可指定算力档位底座');
      if (source.usage === 'agent' && !source.baseProfile) throw validation('Agent 镜像构建必须指定固定算力档位修订');
      const baseImage = await bases.resolve(actor, projectId, source);
      if (source.usage !== 'service' && (!baseImage || !/@sha256:[0-9a-f]{64}$/.test(baseImage))) throw precondition('平台任务或 Agent 底座未固定摘要');
      return { source, commitSha, ...(baseImage ? { baseImage } : {}) };
    },
  };
}
