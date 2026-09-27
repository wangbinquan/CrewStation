export const CONFIG_ENV = { webhookSecret: 'GITHUB_WEBHOOK_SECRET' } as const;
export const PRODUCE_PATH = '/v1/events/produce';
export function readDeploymentInfo(env: Record<string, string | undefined>) {
  const optional = (key: string): string | null => env[key]?.trim() || null;
  const domain = optional('CS_SERVICE_DOMAIN');
  const base = optional('EVENTS_BASE_URL') ?? (domain ? `http://events.${domain}` : null);
  const port = Number(env.PORT);
  return {
    project: optional('CS_PROJECT'), service: optional('CS_SERVICE'), slot: optional('CS_SLOT'),
    environment: optional('CS_ENVIRONMENT'), eventsBaseUrl: base?.replace(/\/+$/, '') ?? null,
    webhookSecret: optional(CONFIG_ENV.webhookSecret), port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 3000,
  };
}
export type DeploymentInfo = ReturnType<typeof readDeploymentInfo>;
