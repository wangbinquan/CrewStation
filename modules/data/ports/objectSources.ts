import type { ObjectSource } from '../domain/objectStorage';

/** Resolves the signed live workload and its release or development admission. Never reads self-reported IDs. */
export interface ObjectSourceResolver {
  resolve(caller: { readonly identity: string; readonly token?: string }): Promise<(ObjectSource & { readonly planId: string }) | undefined>;
}
