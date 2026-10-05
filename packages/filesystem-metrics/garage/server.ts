import { GarageInventoryRequestSchema } from './protocol';
import { observeGarageInventory } from './inventory';

export async function garageInventoryResponse(request: Request, roots: Readonly<Record<string, string>>, timeoutMs: number) {
  const input = GarageInventoryRequestSchema.parse(JSON.parse(await boundedBody(request))), root = roots[input.rootId];
  if (!root) throw Error('garage-native-root-unavailable');
  try {
    const output = await observeGarageInventory(root, input, AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]));
    const body = JSON.stringify(output); if (Buffer.byteLength(body) > 32 * 1024 * 1024) throw Error('garage-native-reply-budget');
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  } catch { return Response.json({ error: 'Garage native inventory unavailable' }, { status: 503 }); }
}
async function boundedBody(request: Request): Promise<string> {
  if (!request.body) throw Error('garage-native-request-empty');
  const reader = request.body.getReader(), parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 24 * 1024 * 1024) throw Error('garage-native-request-budget'); parts.push(part.value); }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } finally { await reader.cancel(); reader.releaseLock(); }
}
