import { EGRESS_HTTP_REQUEST_BYTES, ForwardEgressHttpRequestSchema, ReportBlockedEgressRequestSchema } from '@crewstation/contracts';
import type { AppEnv } from '@crewstation/http';
import { parseBody, requireService } from '@crewstation/http';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { EgressModuleApi } from '../api/moduleApi';

/** 服务域内部接口：出站代理的上报器以服务身份（网关按源 Pod IP 解析）上报被阻请求；不接受用户身份。 */
export function internalEgressRoutes(api: EgressModuleApi): Hono<AppEnv> {
  const r = new Hono<AppEnv>();
  r.post('/internal/egress/http', bodyLimit({ maxSize: Math.ceil(EGRESS_HTTP_REQUEST_BYTES / 3) * 4 + 65536 }), async (c) => {
    const source = requireService(c);
    return api.forwardHttp(source.identity, await parseBody(c, ForwardEgressHttpRequestSchema));
  });
  r.post('/internal/egress/blocked', async (c) => {
    requireService(c);
    const { projectId, fqdn, source } = await parseBody(c, ReportBlockedEgressRequestSchema);
    return c.json(await api.recordBlocked(projectId, fqdn, source), 202);
  });
  return r;
}
