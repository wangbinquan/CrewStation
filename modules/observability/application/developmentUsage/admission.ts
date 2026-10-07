import { DevelopmentUsagePageSchema, DevelopmentUsageRegistrationSchema,
  type DevelopmentUsagePage, type DevelopmentUsageRegistration } from '@crewstation/contracts';
import { jsonHash, precondition, validation } from '@crewstation/kernel';
import { sameDevelopmentRegistration } from '../../domain/developmentNative';
import type { DevelopmentUsageResolved } from '../../ports/developmentUsage';
import type { AcceptedExecutionPrice } from '../../ports/tokenPricing';

/** Same persisted owner, Session registration and accepted CNY price for legacy and original native pages. */
export function prepareDevelopmentAdmission(raw: DevelopmentUsagePage, owner: DevelopmentUsageResolved,
  session: DevelopmentUsageRegistration, accepted: AcceptedExecutionPrice) {
  const source = DevelopmentUsagePageSchema.parse(raw), registration = DevelopmentUsageRegistrationSchema.parse(session);
  const original = DevelopmentUsageRegistrationSchema.parse(owner.registration);
  if (!source.events.length || source.after === source.through) throw validation('开发数值来源页没有连续事件');
  if (!sameDevelopmentRegistration(registration, original) || jsonHash(source.key) !== jsonHash(registration.key)) throw precondition('开发数值来源与原独立登记不符');
  if (jsonHash(owner.price) !== jsonHash(accepted) || jsonHash(owner.price.identity) !== jsonHash(registration.identity) ||
      owner.price.profile?.id !== registration.profileId || owner.price.profile.revision !== registration.profileRevision ||
      !Number.isSafeInteger(owner.price.priceBookRevision) || owner.price.priceBookRevision < 0 || !Number.isFinite(Date.parse(owner.price.acceptedAt))) throw precondition('开发来源必须沿用原执行的档位与人民币受理');
  return { source, registration, original };
}
