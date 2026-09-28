import type { ObjectServiceApi } from '../api/objectServiceApi';

/** Always an attachment; user-controlled names and media types cannot create active console content. */
export function objectDownloadResponse(result: Awaited<ReturnType<ObjectServiceApi['download']>>): Response {
  const filename = encodeURIComponent(result.object.name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(result.body, { status: result.contentRange ? 206 : 200, headers: {
    'content-type': 'application/octet-stream', 'content-length': String(result.size),
    'content-disposition': `attachment; filename="artifact"; filename*=UTF-8''${filename}`,
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'", 'cache-control': 'private, no-store',
    'accept-ranges': 'bytes', 'x-cs-object-sha256': result.object.sha256, ...(result.contentRange ? { 'content-range': result.contentRange } : {}),
  } });
}
