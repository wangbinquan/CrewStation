import type { DeliveryState } from '@crewstation/contracts';
import type { ReactElement } from 'react';
import { useT } from '../../../shared/lib/useT';
import { Badge } from '../../../shared/ui/Badge';
import type { BadgeTone } from '../../../shared/ui/Badge';

/** 投递状态的色调：成功一眼可辨，重试中与死信都用 warning（主题里没有更强的色调）。 */
const TONE: Readonly<Record<DeliveryState, BadgeTone>> = {
  pending: 'neutral',
  delivering: 'info',
  delivered: 'success',
  retrying: 'warning',
  dead: 'warning',
};

export function DeliveryStateBadge({ state }: { readonly state: DeliveryState }): ReactElement {
  const t = useT();
  return <Badge tone={TONE[state]}>{t(`events.deliveryState.${state}`)}</Badge>;
}
