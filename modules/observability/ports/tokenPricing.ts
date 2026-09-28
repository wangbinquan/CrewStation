import type { Actor, ExecutionObservationIdentity, SaveTokenPrice, TokenPricePageQuery, TokenPriceVersion } from '@crewstation/contracts';

export interface PricingProfile {
  id: string; name: string; revision: number;
  protocol: 'opencode' | 'claude-code' | 'terminal'; model: string | null;
}
export interface PricingProfileDirectory {
  /** Owner-provided metadata only: no launch material, credentials or model-test side effect. */
  list(actor: Actor): Promise<PricingProfile[]>;
}
export interface TokenPriceReceipt { readonly fingerprint: string; readonly version: TokenPriceVersion }
export interface TokenPriceScope {
  head(profileId: string): Promise<number>;
  receipt(profileId: string, requestKey: string): Promise<TokenPriceReceipt | undefined>;
  latestMatch(profileId: string, input: SaveTokenPrice): Promise<TokenPriceVersion | undefined>;
  append(version: TokenPriceVersion, requestKey: string, fingerprint: string): Promise<void>;
}
export interface TokenPriceSelection {
  readonly profileId: string; readonly profileRevision: number;
  /** Head frozen at execution acceptance; zero is an explicitly empty catalogue. */
  readonly priceBookRevision: number;
  readonly protocol: 'opencode' | 'claude-code'; readonly provider: string;
  readonly model: string; readonly condition: string | null; readonly acceptedAt: string;
}
export interface TokenPriceStore {
  /** Historical accepted execution identity, never the current mutable profile. */
  select(input: TokenPriceSelection): Promise<TokenPriceVersion | undefined>;
  heads(profileIds: readonly string[]): Promise<ReadonlyMap<string, number>>;
  history(profileId: string, query: TokenPricePageQuery): Promise<TokenPriceVersion[]>;
  /** Serialize one profile's immutable price versions and head in one transaction. */
  change<T>(profileId: string, work: (scope: TokenPriceScope) => Promise<T>): Promise<T>;
}

/** The owner supplies the immutable execution identity and selected profile before launch. */
export interface ExecutionPriceInput {
  identity: ExecutionObservationIdentity;
  profile: { id: string; revision: number; protocol: 'opencode' | 'claude-code' | 'terminal' } | null;
}
export interface AcceptedExecutionPrice extends ExecutionPriceInput {
  acceptedAt: string;
  /** Zero is a frozen empty catalogue, never an invitation to use later prices. */
  priceBookRevision: number;
}
export interface ActualPricingModel { provider: string; model: string; condition: string | null }
export interface ExecutionPriceStore {
  accept(input: ExecutionPriceInput, now: Date): Promise<AcceptedExecutionPrice>;
  get(identity: ExecutionPriceInput['identity']): Promise<AcceptedExecutionPrice | undefined>;
  price(identity: ExecutionPriceInput['identity'], actual: ActualPricingModel | null): Promise<TokenPriceVersion | undefined>;
}
