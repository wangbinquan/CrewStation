import { precondition, validation } from '@crewstation/kernel';
import type { RuntimeRegistryLayout } from '../../domain/registryReference';
import { parseRuntimeImageReference } from '../../domain/registryReference';
import { IndexDocument, ManifestDocument, registryDocuments } from './registryDocuments';

/** 原服务发布构建保留平台架构策略，只把已推送的清单固定为内容摘要。 */
export function serviceImageResolver(layout: RuntimeRegistryLayout, fetcher: typeof fetch = fetch) {
  const read = registryDocuments(layout, fetcher);
  return async (repository: string, input: string): Promise<string> => {
    const ref = parseRuntimeImageReference(input, layout, { exact: [repository] });
    const document = await read(ref.repository, 'manifests', ref.reference);
    if (!ManifestDocument.safeParse(document.value).success && !IndexDocument.safeParse(document.value).success) throw validation('服务构建未产生有效镜像清单');
    return `${layout.pullBase}/${ref.repository}@${document.digest}`;
  };
}

/** 只解析平台配置中的默认镜像；用户选择仍通过版本目录与用途验证。 */
export function configuredImageResolver(layout: RuntimeRegistryLayout, fetcher: typeof fetch = fetch) {
  const resolve = serviceImageResolver(layout, fetcher);
  return async (image: string): Promise<string> => {
    if (!image.startsWith(`${layout.pullBase}/`)) throw precondition('平台任务镜像必须位于受管仓库');
    const repository = image.slice(layout.pullBase.length + 1).split('@')[0]!.replace(/:[^/]*$/, '');
    return resolve(repository, image);
  };
}
