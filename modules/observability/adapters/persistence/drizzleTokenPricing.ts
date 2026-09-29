import { z } from 'zod';
import { UsageExecutionIdentitySchema, ResourceIdSchema } from '@crewstation/contracts';
import type { ExecutionPriceStore, ExecutionPriceInput, AcceptedExecutionPrice } from '../../ports/tokenPricing';
import { ExecutionCostVisibilityDtoSchema, SetExecutionCostVisibilitySchema } from '@crewstation/contracts';
import { conflict, jsonHash, validation } from '@crewstation/kernel';
import type { ExecutionCostVisibilityStore } from '../../ports/usageLedger';
import { and, desc, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import type { SaveTokenPrice, ProjectId, ExecutionCostVisibilityDto } from '@crewstation/contracts';
import type { Database, Executor } from '@crewstation/persistence';
import type { TokenPriceScope, TokenPriceStore, TokenPriceSelection } from '../../ports/tokenPricing';
import { acceptedExecutionPrices, costVisibility, costVisibilityReceipts, tokenPriceHeads, tokenPrices } from './tokenPriceTables';

function matching(profileId: string, input: Pick<SaveTokenPrice, 'profileRevision' | 'protocol' | 'provider' | 'model' | 'condition'>) {
  return and(eq(tokenPrices.profileId, profileId), eq(tokenPrices.profileRevision, input.profileRevision),
    eq(tokenPrices.protocol, input.protocol), eq(tokenPrices.provider, input.provider), eq(tokenPrices.model, input.model),
    input.condition === null ? isNull(tokenPrices.condition) : eq(tokenPrices.condition, input.condition));
}
function scope(executor: Executor): TokenPriceScope {
  return {
    head: async (profileId) => (await executor.select().from(tokenPriceHeads).where(eq(tokenPriceHeads.profileId, profileId)))[0]?.revision ?? 0,
    receipt: async (profileId, requestKey) => {
      const row = (await executor.select().from(tokenPrices).where(and(eq(tokenPrices.profileId, profileId), eq(tokenPrices.requestKey, requestKey))).limit(1))[0];
      return row ? { fingerprint: row.fingerprint, version: row.document } : undefined;
    },
    latestMatch: async (profileId, input) => (await executor.select().from(tokenPrices).where(matching(profileId, input)).orderBy(desc(tokenPrices.revision)).limit(1))[0]?.document,
    append: async (version, requestKey, fingerprint) => {
      await executor.insert(tokenPrices).values({
        profileId: version.profileId, revision: version.revision, id: version.id, requestKey, fingerprint,
        profileRevision: version.profileRevision, protocol: version.protocol, provider: version.provider, model: version.model,
        condition: version.condition, effectiveFrom: version.effectiveFrom, document: version,
      });
      await executor.update(tokenPriceHeads).set({ revision: version.revision }).where(eq(tokenPriceHeads.profileId, version.profileId));
    },
  };
}
async function selected(executor: Executor, input: TokenPriceSelection) {
  if (!Number.isSafeInteger(input.priceBookRevision) || input.priceBookRevision < 0) throw new RangeError('Invalid accepted price catalogue revision');
  const at = new Date(input.acceptedAt);
  if (!Number.isFinite(at.getTime())) throw new RangeError('Invalid execution acceptance timestamp');
  return (await executor.select().from(tokenPrices).where(and(matching(input.profileId, input),
    lte(tokenPrices.revision, input.priceBookRevision), lte(tokenPrices.effectiveFrom, at.toISOString()))).orderBy(desc(tokenPrices.effectiveFrom), desc(tokenPrices.revision)).limit(1))[0]?.document;
}
export function drizzleTokenPriceStore(db: Database): TokenPriceStore {
  return {
    select: (input) => selected(db, input),
    heads: async (profileIds) => profileIds.length === 0 ? new Map() : new Map((await db.select().from(tokenPriceHeads).where(inArray(tokenPriceHeads.profileId, [...profileIds]))).map((row) => [row.profileId, row.revision])),
    history: async (profileId, query) => (await db.select().from(tokenPrices).where(and(
      eq(tokenPrices.profileId, profileId), query.beforeRevision === undefined ? undefined : lt(tokenPrices.revision, query.beforeRevision),
    )).orderBy(desc(tokenPrices.revision)).limit(query.limit)).map((row) => row.document),
    change: (profileId, work) => db.transaction(async (tx) => {
      await tx.insert(tokenPriceHeads).values({ profileId, revision: 0 }).onConflictDoNothing();
      await tx.select().from(tokenPriceHeads).where(eq(tokenPriceHeads.profileId, profileId)).for('update');
      return work(scope(tx));
    }),
  };
}

const hidden = (projectId: ProjectId): ExecutionCostVisibilityDto => ({ projectId, revision: 0, visibility: 'hidden', updatedAt: null });

export function drizzleCostVisibility(db: Database): ExecutionCostVisibilityStore {
  return {
    read: async (projectId) => (await db.select().from(costVisibility).where(eq(costVisibility.projectId, projectId)).limit(1))[0]?.document ?? hidden(projectId),
    save: async (projectId, raw, now) => {
      const input = SetExecutionCostVisibilitySchema.parse(raw), fingerprint = jsonHash(input);
      return db.transaction(async (tx) => {
        await tx.insert(costVisibility).values({ projectId, revision: 0, document: hidden(projectId) }).onConflictDoNothing();
        const [head] = await tx.select().from(costVisibility).where(eq(costVisibility.projectId, projectId)).for('update');
        const receipt = (await tx.select().from(costVisibilityReceipts).where(and(eq(costVisibilityReceipts.projectId, projectId), eq(costVisibilityReceipts.requestKey, input.requestKey))).limit(1))[0];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw conflict('相同请求标识对应不同金额可见性设置');
          return receipt.document;
        }
        if (head!.revision !== input.expectedRevision) throw conflict('金额可见性已变更，请刷新后重试');
        const document = ExecutionCostVisibilityDtoSchema.parse({ projectId, revision: head!.revision + 1, visibility: input.visibility, updatedAt: now.toISOString() });
        await tx.update(costVisibility).set({ revision: document.revision, document }).where(eq(costVisibility.projectId, projectId));
        await tx.insert(costVisibilityReceipts).values({ projectId, requestKey: input.requestKey, fingerprint, document });
        return document;
      });
    },
  };
}

const executionPriceInput = z.strictObject({ identity: UsageExecutionIdentitySchema,
  profile: z.strictObject({ id: ResourceIdSchema, revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), protocol: z.enum(['opencode', 'claude-code', 'terminal']) }).nullable() });
const pricingModel = z.strictObject({ provider: z.string().min(1).max(200), model: z.string().min(1).max(300), condition: z.string().min(1).max(200).nullable() });
const executionPriceWhere = (identity: ExecutionPriceInput['identity']) => and(eq(acceptedExecutionPrices.executionId, identity.executionId), eq(acceptedExecutionPrices.generation, identity.executionGeneration));
async function acceptedPrice(db: Executor, identity: ExecutionPriceInput['identity']) {
  const row = (await db.select().from(acceptedExecutionPrices).where(executionPriceWhere(identity)).limit(1))[0];
  if (row && jsonHash(row.document.identity) !== jsonHash(identity)) throw conflict('执行计价身份不一致');
  return row;
}
async function acceptPrice(db: Database, raw: ExecutionPriceInput, now: Date): Promise<AcceptedExecutionPrice> {
  const parsed = executionPriceInput.safeParse(raw);
  if (!parsed.success || !Number.isFinite(now.getTime())) throw validation('执行计价快照无效');
  const input = parsed.data, fingerprint = jsonHash(input);
  return db.transaction(async (tx) => {
    const existing = await acceptedPrice(tx, input.identity);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw conflict('执行已固定其他计价档位');
      return existing.document;
    }
    let priceBookRevision = 0;
    if (input.profile && input.profile.protocol !== 'terminal') {
      await tx.insert(tokenPriceHeads).values({ profileId: input.profile.id, revision: 0 }).onConflictDoNothing();
      const [head] = await tx.select().from(tokenPriceHeads).where(eq(tokenPriceHeads.profileId, input.profile.id)).for('update');
      priceBookRevision = head!.revision;
    }
    const document = { ...input, acceptedAt: now.toISOString(), priceBookRevision };
    await tx.insert(acceptedExecutionPrices).values({ executionId: input.identity.executionId, generation: input.identity.executionGeneration, fingerprint, document }).onConflictDoNothing();
    const stored = (await acceptedPrice(tx, input.identity))!;
    if (stored.fingerprint !== fingerprint) throw conflict('执行已固定其他计价档位');
    return stored.document;
  });
}
/** Immutable acceptance is independent of later profile edits, deletion and source replay. */
export function drizzleExecutionPricing(db: Database): ExecutionPriceStore {
  return {
    accept: (input, now) => acceptPrice(db, input, now),
    get: async (identity) => (await acceptedPrice(db, UsageExecutionIdentitySchema.parse(identity)))?.document,
    price: async (identity, actual) => {
      const binding = (await acceptedPrice(db, UsageExecutionIdentitySchema.parse(identity)))?.document;
      if (!binding?.profile || binding.profile.protocol === 'terminal' || actual === null) return undefined;
      const model = pricingModel.parse(actual);
      return selected(db, { ...model, profileId: binding.profile.id, profileRevision: binding.profile.revision,
        protocol: binding.profile.protocol, priceBookRevision: binding.priceBookRevision, acceptedAt: binding.acceptedAt });
    },
  };
}
