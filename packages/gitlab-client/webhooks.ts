import type { AddWebhookInput, GitLabProjectRef, GitLabWebhook, GitLabWebhookEvent } from './models';
import type { Transport } from './transport';
import { encodeRef } from './transport';

const EVENT_FLAGS: Record<GitLabWebhookEvent, string> = {
  push: 'push_events', tag_push: 'tag_push_events', issues: 'issues_events', merge_requests: 'merge_requests_events',
  note: 'note_events', pipeline: 'pipeline_events', job: 'job_events', wiki_page: 'wiki_page_events',
  deployment: 'deployment_events', releases: 'releases_events',
};

type RawWebhook = { id: number; project_id: number; url: string; enable_ssl_verification: boolean; created_at: string } & Record<string, unknown>;

function toWebhook(raw: RawWebhook): GitLabWebhook {
  const events = (Object.entries(EVENT_FLAGS) as Array<[GitLabWebhookEvent, string]>).filter(([, flag]) => raw[flag] === true).map(([event]) => event);
  return { id: raw.id, projectId: raw.project_id, url: raw.url, events, enableSslVerification: raw.enable_ssl_verification, createdAt: raw.created_at };
}

export function webhookOperations(transport: Transport) {
  return {
    /** `token` 进请求体的 `token` 字段（GitLab 以 `X-Gitlab-Token` 头回传），不进 URL。 */
    addWebhook: async (id: GitLabProjectRef, input: AddWebhookInput): Promise<GitLabWebhook> => {
      const flags = Object.fromEntries((Object.entries(EVENT_FLAGS) as Array<[GitLabWebhookEvent, string]>).map(([event, flag]) => [flag, input.events.includes(event)]));
      const raw = await transport.request<RawWebhook>('POST', `/projects/${encodeRef(id)}/hooks`, {
        body: { url: input.url, ...(input.token ? { token: input.token } : {}), enable_ssl_verification: input.enableSslVerification ?? true, ...flags },
      });
      return toWebhook(raw);
    },
  };
}
