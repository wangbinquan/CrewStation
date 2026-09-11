import type { ErrorKind } from '@crewstation/kernel';
import { isPlatformError } from '@crewstation/kernel';
import type { Context } from 'hono';

const STATUS_BY_KIND: Record<ErrorKind, number> = {
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthenticated: 401,
  validation: 400,
  precondition: 412,
  quota_exceeded: 429,
  unavailable: 503,
  internal: 500,
};

export function mapErrorToResponse(error: unknown, c: Context): Response {
  if (isPlatformError(error)) {
    return c.json({ error: error.kind, message: error.message, details: error.details }, STATUS_BY_KIND[error.kind] as 400);
  }
  console.error(error);
  return c.json({ error: 'internal', message: '内部错误' }, 500);
}
