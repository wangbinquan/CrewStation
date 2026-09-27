import type { MarketAppDto } from '@crewstation/contracts';
import { marketHref } from './marketHref';

/** 列表、详情与动作使用同一判定；未知及非法地址不能显示为可用。 */
export function marketEntry(app: MarketAppDto) {
  const beta = app.entry.kind === 'trial';
  const href = app.entry.status === 'ready' && !app.maintenance?.blocked && (!beta || app.canPreview) ? marketHref(app.entry.host) : undefined;
  const trial = app.canPreview && app.production.status === 'deployed' ? app.trial : undefined;
  const trialHref = trial?.status === 'ready' ? marketHref(trial.host) : undefined;
  return { beta, href, trial, trialHref, status: href ? 'ready' : app.entry.status === 'unknown' ? 'unknown' : 'unavailable',
    trialStatus: trialHref ? 'ready' : trial?.status === 'unknown' ? 'unknown' : 'unavailable' } as const;
}
