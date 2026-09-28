import type { Actor, SaveTokenPrice, TokenPriceHistory, TokenPricePageQuery, TokenPriceProfile, TokenPriceVersion } from '@crewstation/contracts';

export interface TokenPricingApi {
  pricingProfiles(actor: Actor): Promise<{ items: TokenPriceProfile[] }>;
  priceHistory(actor: Actor, profileId: string, query: TokenPricePageQuery): Promise<TokenPriceHistory>;
  savePrice(actor: Actor, profileId: string, input: SaveTokenPrice): Promise<TokenPriceVersion>;
}
