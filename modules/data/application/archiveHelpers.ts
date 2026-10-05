import { createHash, createHmac } from 'node:crypto';
import { jsonHash, newResourceId, notFound, validation } from '@crewstation/kernel';
import type { ArchiveHelperApi, ArchiveHelperCaller } from '../api/archiveHelperApi';
import type { ArchiveBindingRepository } from '../ports/archiveBindings';
import type { ArchiveHelperRepository } from '../ports/archiveHelpers';
import type { ObjectServiceDeps } from './objectService';
import type { ArchivePlanRepository } from '../ports/archivePlans';
import { uploadDto } from '../domain/objectStorage';
import { transferObject } from './objectTransfer';

export function archiveHelpers(deps: Pick<ObjectServiceDeps, 'catalog' | 'uploads' | 'plane' | 'owner' | 'requests'> & {
  helpers: ArchiveHelperRepository; bindings: ArchiveBindingRepository; plans: ArchivePlanRepository; secretKeyBase64: string;
}): ArchiveHelperApi {
  const context = async (caller: ArchiveHelperCaller) => {
    if (caller.token.length > 256) throw validation('归档助手凭证无效');
    const grant = await deps.helpers.authenticate(caller.id, createHash('sha256').update(caller.token).digest('hex'), caller.podUid);
    const binding = await deps.bindings.get(grant.bindingId), space = binding ? await deps.catalog.space(binding.spaceId) : undefined;
    if (!binding || !space) throw notFound('归档绑定');
    return { grant, binding, space, source: { projectId: space.projectId, serviceId: space.serviceId, env: space.env, fenced: false } };
  };
  const uploading = async (caller: ArchiveHelperCaller, id: string) => {
    const scope = await context(caller), upload = await deps.uploads.get(id);
    if (!upload?.archive || upload.spaceId !== scope.space.id || upload.archive.bindingId !== scope.binding.id || upload.archive.revision !== scope.binding.revision) throw notFound('归档上传');
    return { ...scope, upload, authority: { source: scope.source, archive: { ...upload.archive, grantId: scope.grant.id } } };
  };
  return {
    issue: async (input) => {
      // Deterministic for one durable attempt: a crash before Secret creation can replay without storing plaintext.
      const token = createHmac('sha256', Buffer.from(deps.secretKeyBase64, 'base64')).update(`archive-helper-v1:${jsonHash(input)}`).digest('base64url');
      await deps.helpers.grant({ ...input, tokenHash: createHash('sha256').update(token).digest('hex'), closedAt: null, podUid: null });
      return { token };
    },
    close: deps.helpers.close,
    bind: deps.helpers.bind,
    complete: (caller) => deps.helpers.complete(caller.id, createHash('sha256').update(caller.token).digest('hex'), caller.podUid),
    fail: (caller, input) => deps.helpers.fail(caller.id, createHash('sha256').update(caller.token).digest('hex'), caller.podUid, input),
    entries: async (caller, offset, limit) => deps.helpers.entries((await context(caller)).grant, offset, limit),
    upload: async (caller, input) => {
      const { grant, binding, space, source } = await context(caller);
      const entry = binding.planId ? await deps.plans.file(binding.planId, input.path) : undefined;
      if (!entry) throw notFound('归档清单文件');
      const identity = { bindingId: binding.id, revision: grant.revision, path: input.path };
      return uploadDto(await deps.uploads.reserve(space.id, newResourceId(), {
        requestKey: `archive:${binding.id}:${grant.revision}:${jsonHash(input.path)}`, name: entry.name, mediaType: 'application/octet-stream', size: input.size, sha256: input.sha256,
      }, { source, archive: { ...identity, grantId: grant.id } }));
    },
    status: async (caller, id) => uploadDto((await uploading(caller, id)).upload),
    content: async (caller, id, input) => {
      const { upload, authority } = await uploading(caller, id);
      if (input.length !== upload.size) throw validation('Content-Length 与归档文件声明不符');
      const claim = await deps.uploads.begin(id, newResourceId(), deps.owner, authority);
      await transferObject(deps, claim, input.body, input.signal);
      return uploadDto((await deps.uploads.get(id))!);
    },
    commit: async (caller, id) => { const { authority } = await uploading(caller, id); return uploadDto(await deps.uploads.requestCommit(id, authority)); },
    result: async (caller, input) => {
      const { grant, binding } = await context(caller);
      await deps.helpers.record({ bindingId: binding.id, revision: grant.revision, grantId: grant.id, path: input.path }, input);
    },
  };
}
