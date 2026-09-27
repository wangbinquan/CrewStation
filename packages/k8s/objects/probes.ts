/** Structural HTTP probe input; callers validate product limits before rendering Kubernetes objects. */
export interface HttpProbeSpec {
  readonly path: string;
  readonly timeoutSeconds: number;
  readonly periodSeconds: number;
  readonly failureThreshold: number;
  readonly initialDelaySeconds: number;
}
export interface HttpProbesSpec {
  readonly startup?: HttpProbeSpec;
  readonly readiness?: HttpProbeSpec;
  readonly liveness?: HttpProbeSpec;
}

export function httpProbeObjects(port: number | undefined, healthPath: string | undefined, probes?: HttpProbesSpec): Record<string, unknown> {
  if (!port) return {};
  const result: Record<string, unknown> = healthPath ? {
    readinessProbe: { httpGet: { path: healthPath, port }, periodSeconds: 5, failureThreshold: 3 },
    livenessProbe: { httpGet: { path: healthPath, port }, periodSeconds: 10, failureThreshold: 6, initialDelaySeconds: 10 },
  } : {};
  for (const kind of ['startup', 'readiness', 'liveness'] as const) {
    const value = probes?.[kind];
    if (!value) continue;
    const { path, ...timing } = value;
    result[`${kind}Probe`] = { httpGet: { path, port }, ...timing };
  }
  return result;
}
