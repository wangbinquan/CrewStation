import { z } from 'zod';
import { precondition } from '@crewstation/kernel';
import type { ObjectPhysicalObservation } from '../../ports/objectPlane';

const bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const partition = z.object({ available: bytes, total: bytes }).refine((p) => p.available <= p.total);
const statusSchema = z.object({ nodes: z.array(z.object({ id: z.string(), isUp: z.boolean(), draining: z.boolean(), role: z.object({ capacity: bytes.nullable().optional() }).nullable().optional(), dataPartition: partition.nullable().optional() })).max(128) });
const healthSchema = z.object({ status: z.enum(['healthy', 'degraded', 'unavailable']) });
async function readGarageJson(endpoint: string, operation: string, token: string, signal: AbortSignal): Promise<unknown> {
  const base = new URL(endpoint);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw precondition('Garage 观测地址无效');
  const response = await fetch(new URL(`/v2/${operation}`, base), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]), redirect: 'error' });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw precondition('Garage 观测暂不可用'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 262_144) { await reader.cancel(); throw precondition('Garage 观测响应过大'); } chunks.push(item.value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

/** Report the most constrained data node, never a sum that could double-count a shared disk. */
export async function observeGarage(config: { endpoint: string; token: string }, signal: AbortSignal): Promise<ObjectPhysicalObservation> {
  const [status, health] = await Promise.all([readGarageJson(config.endpoint, 'GetClusterStatus', config.token, signal).then((v) => statusSchema.parse(v)), readGarageJson(config.endpoint, 'GetClusterHealth', config.token, signal).then((v) => healthSchema.parse(v))]);
  const nodes = status.nodes.filter((node) => node.role?.capacity !== null && node.role?.capacity !== undefined && !node.draining);
  const complete = nodes.length > 0 && nodes.every((node) => node.isUp && node.dataPartition);
  const tightest = complete ? nodes.reduce((a, b) => a.dataPartition!.available <= b.dataPartition!.available ? a : b).dataPartition! : undefined;
  return { freeBytes: tightest?.available ?? null, totalBytes: tightest?.total ?? null, physicalObservedAt: new Date().toISOString(), health: health.status === 'healthy' ? 'ready' : health.status };
}
