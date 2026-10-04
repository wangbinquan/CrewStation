import { z } from 'zod';

export const SessionProcessSchema = z.strictObject({ podUid: z.uuid(), containerId: z.string().regex(/^[a-z0-9]+:\/\/[a-f0-9]{64}$/),
  nodeUid: z.uuid(), nodeName: z.string().min(1).max(253), pid: z.number().int().positive(), pidNamespace: z.string().regex(/^[0-9]+$/),
  bootId: z.uuid(), startTicks: z.string().regex(/^[0-9]+$/) });
