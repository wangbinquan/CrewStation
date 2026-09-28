import { createHash, createHmac } from 'node:crypto';
import { validation } from '@crewstation/kernel';

export const EMPTY_OBJECT_SHA256 = createHash('sha256').update('').digest('hex');
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const hmac = (key: string | Buffer, text: string): Buffer => createHmac('sha256', key).update(text).digest();
const encode = (text: string): string => encodeURIComponent(text).replace(/[!'()*]/g, (value) => `%${value.charCodeAt(0).toString(16).toUpperCase()}`);

/** S3 SigV4, payload hash supplied in advance; no multipart, presigning or implicit request retries. */
export function signObjectRequest(input: {
  url: URL; method: string; region: string; accessKeyId: string; secretAccessKey: string;
  payloadHash?: string; headers?: Record<string, string>; now?: Date;
}): Headers {
  const time = (input.now ?? new Date()).toISOString().replace(/[-:]|\.\d{3}/g, ''), day = time.slice(0, 8);
  const hash = input.payloadHash ?? EMPTY_OBJECT_SHA256;
  const canonical = Object.fromEntries(Object.entries({ ...input.headers, host: input.url.host, 'x-amz-content-sha256': hash, 'x-amz-date': time })
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')]).sort(([a], [b]) => a! < b! ? -1 : a! > b! ? 1 : 0));
  const names = Object.keys(canonical).join(';');
  const query = [...input.url.searchParams].map(([key, value]) => [encode(key), encode(value)]).sort(([a, av], [b, bv]) => a! < b! ? -1 : a! > b! ? 1 : av! < bv! ? -1 : av! > bv! ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('&');
  const request = [input.method, input.url.pathname, query, Object.entries(canonical).map(([key, value]) => `${key}:${value}\n`).join(''), names, hash].join('\n');
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), 's3'), 'aws4_request');
  const signature = hmac(key, ['AWS4-HMAC-SHA256', time, scope, sha256(request)].join('\n')).toString('hex');
  return new Headers({ ...canonical, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${names},Signature=${signature}` });
}

export function objectEndpointUrl(endpoint: string, bucket: string, key?: string): URL {
  const root = new URL(endpoint);
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash || root.pathname !== '/') throw validation('对象后端地址必须是可信的 HTTP(S) 根地址');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) throw validation('无效对象 bucket');
  if (key !== undefined && (!key || key.split('/').some((p) => !p || p === '.' || p === '..') || /[\\\x00-\x1f\x7f]/.test(key))) throw validation('无效对象物理定位');
  return new URL(`/${encode(bucket)}${key === undefined ? '' : `/${key.split('/').map(encode).join('/')}`}`, root);
}
