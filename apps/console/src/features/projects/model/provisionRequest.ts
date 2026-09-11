import { ApiClientError, parseErrorEnvelope } from '@crewstation/api-client';

/**
 * `POST /v1/projects/:projectId/provision`（管理员重跑开通链）还没有进入 api-client，
 * 这里按同样的约定直接请求：同源、带 Cookie，失败时抛出同一个 ApiClientError，
 * 页面因此可以用 errorMessage() 统一渲染，等 api-client 补上方法后只换这一处实现。
 */
export async function retryProvisioning(projectId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/v1/projects/${encodeURIComponent(projectId)}/provision`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch (cause) {
    // 断网、DNS 与 CORS 失败在 api-client 里同样是 status 0 + unavailable。
    const message = cause instanceof Error && cause.message ? cause.message : '网络请求失败';
    throw new ApiClientError(0, { error: 'unavailable', message, details: {} }, { cause });
  }
  if (!response.ok) throw new ApiClientError(response.status, parseErrorEnvelope(response.status, await readBody(response)));
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
