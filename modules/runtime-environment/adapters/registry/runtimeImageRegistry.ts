import type { RuntimeImageArchitecture } from '@crewstation/contracts';
import { validation } from '@crewstation/kernel';
import type { RegistryRepositoryAccess, RuntimeRegistryLayout } from '../../domain/registryReference';
import { parseRuntimeImageReference } from '../../domain/registryReference';
import type { RuntimeImageRegistry } from '../../ports/registry';
import { ConfigDocument, IndexDocument, ManifestDocument, registryDocuments } from './registryDocuments';

export function httpRuntimeImageRegistry(layout: RuntimeRegistryLayout, fetcher: typeof fetch = fetch): RuntimeImageRegistry {
  const read = registryDocuments(layout, fetcher);
  return {
    inspect: async (input: string, architecture: RuntimeImageArchitecture, access: RegistryRepositoryAccess) => {
      const { repository, reference } = parseRuntimeImageReference(input, layout, access);
      let document = await read(repository, 'manifests', reference);
      const index = IndexDocument.safeParse(document.value);
      if (index.success) {
        const selected = index.data.manifests.filter((v) => `${v.platform?.os}/${v.platform?.architecture}` === architecture && (!v.platform?.variant || (architecture === 'linux/arm64' && v.platform.variant === 'v8')));
        if (selected.length !== 1) throw validation('多架构镜像没有唯一匹配的目标架构产物');
        document = await read(repository, 'manifests', selected[0]!.digest);
      }
      const manifest = ManifestDocument.parse(document.value), config = ConfigDocument.parse((await read(repository, 'blobs', manifest.config.digest)).value);
      if (`${config.os}/${config.architecture}` !== architecture) throw validation('镜像实际架构与所选架构不一致');
      if (config.rootfs.diff_ids.length !== manifest.layers.length) throw validation('镜像基础层元数据不完整');
      return { repository: `${layout.pullBase}/${repository}`, digest: document.digest, architecture, diffIds: config.rootfs.diff_ids, user: config.config.User ?? '', entrypoint: config.config.Entrypoint ?? [], command: config.config.Cmd ?? [] };
    },
  };
}
