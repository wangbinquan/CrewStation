import { newResourceId } from '@crewstation/kernel';
import type { IdentityAlias } from './model';

export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const identityKey = (keys: readonly string[]): string => JSON.stringify(keys);
const mapKey = (kind: string, key: string): string => JSON.stringify([kind, key]);

/** Names are scoped by entity kind and all original key columns, never just a shared suffix. */
export class ResourceIdentityMap {
  private readonly entries = new Map<string, IdentityAlias>();
  private readonly owners = new Map<string, IdentityAlias>();

  constructor(aliases: readonly IdentityAlias[] = []) {
    for (const alias of aliases) this.add(alias);
  }

  add(alias: IdentityAlias): void {
    if (!UUID_V7_PATTERN.test(alias.id)) throw new Error(`Invalid UUIDv7 in migration mapping for ${alias.kind}`);
    const key = mapKey(alias.kind, alias.key), current = this.entries.get(key);
    if (current && current.id !== alias.id) throw new Error(`Conflicting identity mapping for ${alias.kind} ${alias.key}`);
    const owner = this.owners.get(alias.id);
    if (owner && owner.kind !== alias.kind) throw new Error(`UUIDv7 belongs to both ${owner.kind} and ${alias.kind}`);
    this.entries.set(key, alias);
    if (!owner) this.owners.set(alias.id, alias);
  }

  allocate(kind: string, keys: readonly string[], currentId?: string): IdentityAlias {
    const key = identityKey(keys), existing = this.entries.get(mapKey(kind, key));
    if (existing) return existing;
    const alias = { kind, key, id: currentId && UUID_V7_PATTERN.test(currentId) ? currentId : newResourceId() };
    const owner = this.owners.get(alias.id);
    if (owner && (owner.kind !== kind || owner.key !== key)) throw new Error(`Duplicate resource identity for ${kind} ${key}`);
    this.add(alias);
    return alias;
  }

  resolve(kind: string, keys: readonly string[], context?: string): string {
    const alias = this.entries.get(mapKey(kind, identityKey(keys)));
    if (alias) return alias.id;
    if (keys.length === 1 && this.owners.get(keys[0]!)?.kind === kind) return keys[0]!;
    throw new Error(`Unresolved resource identity: ${kind} ${identityKey(keys)}${context ? ` at ${context}` : ''}`);
  }

  values(): IdentityAlias[] { return [...this.entries.values()]; }
}
