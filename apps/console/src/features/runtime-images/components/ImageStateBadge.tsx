import type { RuntimeImageBuildDto, RuntimeImageValidationDto, RuntimeImageVersionDto } from '@crewstation/contracts';
import { useT } from '../../../shared/lib/useT';
import { Badge, type BadgeTone } from '../../../shared/ui/Badge';

type State = RuntimeImageBuildDto['state'] | RuntimeImageValidationDto['state'] | RuntimeImageVersionDto['state'];

/** 产物登记不等于验证通过；状态与算力目录使用同一套颜色语义。 */
export function ImageStateBadge({ state }: { readonly state: State }) {
  const t = useT();
  const tone: BadgeTone = state === 'failed' ? 'danger'
    : ['succeeded', 'passed'].includes(state) ? 'success'
      : ['unknown', 'disabled', 'cancelling', 'cancelled', 'retiring'].includes(state) ? 'warning'
        : state === 'retired' ? 'neutral' : 'info';
  return <span><Badge tone={tone}>{t(`images.state.${state}`)}</Badge></span>;
}
