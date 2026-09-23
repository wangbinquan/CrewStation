import type { DeliveryState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';

/** 投递状态的色调：重试中还会自己恢复，用 warning；死信要人工重放，用 danger；维护暂存等维护结束自动补发，用 info。 */
const TONE: Readonly<Record<DeliveryState, BadgeTone>> = {
  pending: 'neutral',
  delivering: 'info',
  delivered: 'success',
  retrying: 'warning',
  dead: 'danger',
  held: 'info',
};

export function DeliveryStateBadge({ state }: { readonly state: DeliveryState }): ReactElement {
  const t = useT();
  return <Badge tone={TONE[state]}>{t(`events.deliveryState.${state}`)}</Badge>;
}
