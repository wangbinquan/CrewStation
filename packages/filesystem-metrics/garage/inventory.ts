import { GarageInventoryRequestSchema, GarageInventoryResponseSchema, garageRequestIdentity } from './protocol';
import type { GarageInventoryRequest } from './protocol';
import { observeGarageMetadata } from './metadata';
import { observeGarageBlocks } from './blocks';

/** Native rows are checked again after the full physical walk, so asynchronous
 * Garage deletion propagation cannot produce a mixed-generation inventory. */
export async function observeGarageInventory(root: string, raw: GarageInventoryRequest, signal: AbortSignal) {
  const input = GarageInventoryRequestSchema.parse(raw);
  const metadata = await observeGarageMetadata(root, input.metadataDirectory, input.query, signal);
  const blocks = await observeGarageBlocks(root, input.dataDirectory, metadata.blocks, signal);
  const after = await observeGarageMetadata(root, input.metadataDirectory, input.query, signal);
  if (metadata.revision !== after.revision || JSON.stringify(metadata.source) !== JSON.stringify(after.source)) throw Error('garage-native-inventory-changed');
  if (metadata.source.rootIdentity !== blocks.rootIdentity) throw Error('garage-native-inventory-root-conflict');
  return GarageInventoryResponseSchema.parse({ key: input.key, requestIdentity: garageRequestIdentity(input), complete: true, metadata: after, blocks });
}
