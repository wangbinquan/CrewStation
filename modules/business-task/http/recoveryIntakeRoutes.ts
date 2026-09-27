import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '@crewstation/http';
import { parseParams, requireService } from '@crewstation/http';
import { BusinessRecoveryClaimSchema, BusinessRecoveryReadSchema, BusinessRecoveryRejectSchema, ResourceIdSchema } from '@crewstation/contracts';
import type { BusinessExecutionApi } from '../api/executionApi';
import { executionBody } from './executionBody';

export function recoveryIntakeRoutes(api: BusinessExecutionApi): Hono<AppEnv> {
  const router = new Hono<AppEnv>(), root = '/v3/business-execution/recovery';
  const caller = (c: Context<AppEnv>) => { const identity = requireService(c); return { identity: identity.identity, token: identity.token }; };
  const id = (c: Context<AppEnv>) => parseParams(c, z.object({ requestId: ResourceIdSchema })).requestId;
  // Keep the lease out of URLs/access logs. Reading is strictly side-effect free despite POST.
  router.post(`${root}/:requestId/read`, async (c) => c.json(await api.readRecovery(caller(c), id(c), await executionBody(c, BusinessRecoveryReadSchema))));
  router.post(`${root}/claim`, async (c) => c.json(await api.claimRecovery(caller(c), await executionBody(c, BusinessRecoveryClaimSchema))));
  router.post(`${root}/:requestId/reject`, async (c) => c.json(await api.rejectRecovery(caller(c), id(c), await executionBody(c, BusinessRecoveryRejectSchema))));
  return router;
}
