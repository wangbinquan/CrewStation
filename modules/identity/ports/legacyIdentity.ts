export interface LegacyIdentityLookup {
  resolve(kind: string, keys: readonly string[]): Promise<string | undefined>;
}
