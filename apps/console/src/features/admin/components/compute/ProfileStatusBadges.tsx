import type { ComputeProfileAvailability, ProfileTestDto } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { availabilityTone, testTone } from '../../model/profileStatus';

/** 租户能不能选：可用／测试中／测试失败／未测试／已停用；不可用时把原因写在旁边，管理员不用猜。 */
export function AvailabilityBadge({ availability }: { readonly availability: ComputeProfileAvailability }): ReactElement {
  const t = useT();
  return (
    <span title={availability.reason}>
      <Badge tone={availabilityTone(availability.state)}>{t(`admin.profile.availability.${availability.state}`)}</Badge>
      {availability.reason && !availability.available ? <small> {availability.reason}</small> : null}
    </span>
  );
}

/** 最近一次测试的状态与归类；没有测试记录时显示「尚无测试」。 */
export function TestSummaryBadge({ test, compact = false }: { readonly test: ProfileTestDto | undefined; readonly compact?: boolean }): ReactElement {
  const t = useT();
  if (compact) return <small title={test?.error}>
    {t(test ? `admin.profile.test.state.${test.state}` : 'admin.profile.test.none')}
    {test?.outcome && test.outcome !== 'passed' ? ` · ${t(`admin.profile.test.outcomeShort.${test.outcome}`)}` : ''}
    {test ? ` · ${t('admin.profile.test.revision', { revision: test.revision })}` : ''}
  </small>;
  if (!test) return <Badge tone="neutral">{t('admin.profile.test.none')}</Badge>;
  return (
    <span title={test.error}>
      <Badge tone={testTone(test.state)}>{t(`admin.profile.test.state.${test.state}`)}</Badge>
      {test.outcome && test.outcome !== 'passed' ? <small> {t(`admin.profile.test.outcomeShort.${test.outcome}`)}</small> : null}
      <small> · {t('admin.profile.test.revision', { revision: test.revision })}</small>
    </span>
  );
}
