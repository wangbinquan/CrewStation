import { RuntimeImageBuildRenderSchema } from '@crewstation/contracts';
import type { RuntimeImageBuildRender } from '@crewstation/contracts';

/** 独立镜像构建使用自己的 build 身份，不伪造 releaseId。 */
export function imageBuildRenderOf(spec: { readonly children: readonly { kind: string; name: string; namespace?: string }[]; readonly [key: string]: unknown }): RuntimeImageBuildRender | undefined {
  const parsed = RuntimeImageBuildRenderSchema.safeParse(spec['runtimeImageBuild']);
  if (!parsed.success) return undefined;
  const job = parsed.data;
  if (spec.children.length !== 2 || !spec.children.some((c) => c.kind === 'Job' && c.name === job.name && c.namespace === job.namespace) || !spec.children.some((c) => c.kind === 'Secret' && c.name === job.secret && c.namespace === job.namespace)) return undefined;
  return job;
}
