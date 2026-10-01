import { LegacyProducedEventSchema, ProducedEventSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, requireService } from '@crewstation/http';
import { Hono } from 'hono';
import { forbidden } from '@crewstation/kernel';
import type { EventsModuleApi } from '../api/moduleApi';

/** 网关来源令牌在读取正文前固定原 UUID；正文迟到不能按同名新项目重新绑定。 */
export function ingressRoutes(api: EventsModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/v2/events/produce', async (c) => {
    const caller = await api.resolveIngressSource(requireService(c));
    if (!caller) throw forbidden('事件来源的原项目或服务身份无法核实');
    return c.json(await api.produce(caller, await parseBody(c, ProducedEventSchema)), 202);
  });
  r.post('/v1/events/produce', async (c) => {
    const caller = await api.resolveIngressSource(requireService(c));
    if (!caller) throw forbidden('事件来源的原项目或服务身份无法核实');
    return c.json(await api.produceLegacy(caller, await parseBody(c, LegacyProducedEventSchema)), 202);
  });
  return r;
}
