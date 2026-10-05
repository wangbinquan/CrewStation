import { forbidden, newResourceId, notFound, precondition, validation } from '@crewstation/kernel';
import type { ObjectServiceApi, ObjectServiceCaller } from '../api/objectServiceApi';
import { spaceDto, storedObjectDto, uploadDto } from '../domain/objectStorage';
import type { ObjectBackendPlane, ObjectCatalogRepository, ObjectReadRepository, ObjectUploadRepository } from '../ports/objectStorage';
import type { ObjectContentRepository } from '../ports/objectContent';
import type { ObjectSourceResolver } from '../ports/objectSources';
import { transferObject } from './objectTransfer';
import { downloadStoredObject } from './objectDownload';
import type { ObjectRequestRunner } from '../ports/deletion/objectWork';

export interface ObjectServiceDeps { requests?: ObjectRequestRunner; catalog: ObjectCatalogRepository; uploads: ObjectUploadRepository; reads: ObjectReadRepository; content: ObjectContentRepository; plane: ObjectBackendPlane; sources: ObjectSourceResolver; owner: string }
export function objectService(deps: ObjectServiceDeps): ObjectServiceApi {
  const scope = async (caller: ObjectServiceCaller) => {
    const source = await deps.sources.resolve(caller);
    if (!source) throw forbidden('缺少已声明对象存储的有效服务发布或开发会话身份');
    const space = await deps.catalog.serviceSpace(source.serviceId, source.env);
    if (!space || space.projectId !== source.projectId) throw precondition('服务对象空间尚未供给', { code: 'object_space_unavailable' });
    return { source, space };
  };
  const uploadScope = async (caller: ObjectServiceCaller, id: string) => {
    const context = await scope(caller), upload = await deps.uploads.get(id);
    if (!upload || upload.spaceId !== context.space.id) throw notFound('对象上传');
    return { ...context, upload };
  };
  const objectScope = async (caller: ObjectServiceCaller, id: string) => {
    const context = await scope(caller), object = await deps.reads.object(id);
    if (!object || object.spaceId !== context.space.id) throw notFound('对象');
    return { ...context, object };
  };
  return {
    space: async (caller) => spaceDto((await scope(caller)).space),
    upload: async (caller, input) => { const { source, space } = await scope(caller); return uploadDto(await deps.uploads.reserve(space.id, newResourceId(), input, { source, ...(input.fence ? { fence: input.fence } : {}) })); },
    uploadStatus: async (caller, id) => uploadDto((await uploadScope(caller, id)).upload),
    content: async (caller, id, input) => {
      const { source, upload } = await uploadScope(caller, id);
      if (input.length !== upload.size) throw validation('Content-Length 与上传声明不符');
      const claim = await deps.uploads.begin(id, newResourceId(), deps.owner, { source, ...(input.fence ? { fence: input.fence } : {}) });
      await transferObject(deps, claim, input.body, input.signal);
      return uploadDto((await deps.uploads.get(id))!);
    },
    commit: async (caller, id, input) => { const { source } = await uploadScope(caller, id); return uploadDto(await deps.uploads.requestCommit(id, { source, ...(input.fence ? { fence: input.fence } : {}) })); },
    list: async (caller, input) => { const { space } = await scope(caller), page = await deps.reads.page(space.id, input.cursor, input.limit); return { items: page.items.map(storedObjectDto), nextCursor: page.nextCursor }; },
    get: async (caller, id) => storedObjectDto((await objectScope(caller, id)).object),
    reference: async (caller, id, input, desired) => { const { source } = await objectScope(caller, id); return storedObjectDto(await deps.content.reference(id, input, desired, { source, ...(input.fence ? { fence: input.fence } : {}) })); },
    delete: async (caller, id, input) => { const { source } = await objectScope(caller, id); return storedObjectDto(await deps.content.delete(id, input, { source, ...(input.fence ? { fence: input.fence } : {}) })); },
    download: async (caller, id, input) => {
      const { source } = await objectScope(caller, id);
      return downloadStoredObject(deps, id, source, input);
    },
  };
}
