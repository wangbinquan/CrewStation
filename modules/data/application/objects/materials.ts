import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { BusinessMaterialObjectSchema, ProjectIdSchema, ServiceIdSchema, ResourceIdSchema } from '@crewstation/contracts';
import { forbidden } from '@crewstation/kernel';
import type { MaterialObjectApi } from '../../api/materialObjectApi';
import type { MaterialObjectRepository } from '../../ports/objectContent';
import type { ObjectSourceResolver } from '../../ports/objectSources';
import { downloadStoredObject, type ObjectDownloadDeps } from '../objectDownload';

const GrantSchema = z.strictObject({ version: z.literal(1), projectId: ProjectIdSchema, serviceId: ServiceIdSchema, materialId: ResourceIdSchema, object: BusinessMaterialObjectSchema, expires: z.number().int().positive() });
export function materialObjectUseCases(deps: ObjectDownloadDeps & { materials: MaterialObjectRepository; sources: ObjectSourceResolver; secretKeyBase64: string; apiUrl: string; now?: () => number }): MaterialObjectApi {
  const now = deps.now ?? Date.now, secret = Buffer.from(deps.secretKeyBase64, 'base64');
  const mac = (value: string) => createHmac('sha256', secret).update(`material-download-v1:${value}`).digest();
  return {
    pin: async (caller, input) => {
      const source = await deps.sources.resolve(caller);
      if (!source || source.projectId !== input.projectId || source.serviceId !== input.serviceId || source.env !== 'production') throw forbidden('材料来源服务身份不匹配');
      await deps.materials.pin(input, { source, ...(input.fence ? { fence: input.fence } : {}) });
    },
    check: deps.materials.check,
    release: deps.materials.release,
    grants: async (input) => {
      await deps.materials.check(input);
      const expires = now() + 30 * 60_000;
      return input.objects.map((object) => {
        const body = Buffer.from(JSON.stringify({ version: 1, projectId: input.projectId, serviceId: input.serviceId, materialId: input.materialId, object, expires })).toString('base64url');
        return { object, url: `${deps.apiUrl.replace(/\/$/, '')}/internal/material-objects/${object.objectId}`, token: `${body}.${mac(body).toString('base64url')}`, expiresAt: new Date(expires).toISOString() };
      });
    },
    download: async (objectId, token, signal) => {
      const reject = () => forbidden('材料下载授权无效或已到期');
      if (token.length > 4096) throw reject();
      const [body, signature, extra] = token.split('.');
      if (!body || !signature || extra !== undefined) throw reject();
      const actual = Buffer.from(signature, 'base64url'), expected = mac(body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw reject();
      let raw: unknown;
      try { raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw reject(); }
      const parsed = GrantSchema.safeParse(raw);
      if (!parsed.success || parsed.data.expires <= now() || parsed.data.object.objectId !== objectId) throw reject();
      const grant = parsed.data;
      await deps.materials.check({ ...grant, objects: [grant.object] });
      return downloadStoredObject(deps, objectId, { projectId: grant.projectId, serviceId: grant.serviceId, env: 'production', fenced: false }, { signal });
    },
  };
}
