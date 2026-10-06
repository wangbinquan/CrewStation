import type { Context } from 'hono';
import type { AppEnv } from './identity';

/** A verified long handler may finish before sending JSON without resetting its response socket. */
export function keepResponseOpen(context: Context<AppEnv>): void {
  context.env?.timeout?.(context.req.raw, 0);
}
