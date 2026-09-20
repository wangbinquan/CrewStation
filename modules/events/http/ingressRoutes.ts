import type { ServiceActor } from '@crewstation/contracts';
import { LegacyProducedEventSchema, ProducedEventSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, requireService } from '@crewstation/http';
import { Hono } from 'hono';
import type { EventsModuleApi } from '../api/moduleApi';

/** cs-events 的服务域入口：生产方身份由网关按源 Pod IP 解析并注入，这里不看任何凭据；受理即 202。 */
export function ingressRoutes(api: EventsModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/v2/events/produce', async (c) => {
    const source = requireService(c);
    const caller: ServiceActor = { identity: source.identity, project: source.project, service: source.service, ...(source.slot ? { slot: source.slot } : {}) };
    return c.json(await api.produce(caller, await parseBody(c, ProducedEventSchema)), 202);
  });
  r.post('/v1/events/produce', async (c) => {
    const source = requireService(c);
    return c.json(await api.produceLegacy(source, await parseBody(c, LegacyProducedEventSchema)), 202);
  });
  return r;
}
