import { z } from 'zod';

/** HTTP probes always use the declared service port; no arbitrary host or credential headers. */
export const ServiceHttpProbeSchema = z.strictObject({
  path: z.string().startsWith('/').max(2048),
  timeoutSeconds: z.number().int().min(1).max(60).default(1),
  periodSeconds: z.number().int().min(1).max(300).default(5),
  failureThreshold: z.number().int().min(1).max(120).default(3),
  initialDelaySeconds: z.number().int().min(0).max(3600).default(0),
});
export const ServiceProbesSchema = z.strictObject({
  startup: ServiceHttpProbeSchema.optional(), readiness: ServiceHttpProbeSchema.optional(), liveness: ServiceHttpProbeSchema.optional(),
});

export type ServiceHttpProbe = z.infer<typeof ServiceHttpProbeSchema>;
export type ServiceProbes = z.infer<typeof ServiceProbesSchema>;
