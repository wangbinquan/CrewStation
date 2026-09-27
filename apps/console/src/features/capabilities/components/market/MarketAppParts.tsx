import type { MarketAppDto } from '@crewstation/contracts';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { ActionRow } from '../../../../shared/ui/ActionRow';
import { Badge } from '../../../../shared/ui/Badge';
import { Button } from '../../../../shared/ui/Button';
import { ExternalButtonLink } from '../../../../shared/ui/navigation/ButtonLink';
import { marketEntry } from './marketEntry';
import styles from './Market.module.css';

export function MarketAppStatus({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), entry = marketEntry(app);
  return <div className={styles.status}>
    <Badge tone={app.maintenance || entry.status === 'unknown' ? 'warning' : entry.href ? entry.beta ? 'info' : 'success' : 'neutral'}>
      {app.maintenance ? t(app.maintenance.blocked ? 'market.maintenance.blocked' : 'market.maintenance.badge') : `${entry.beta ? 'Beta' : t('market.productionShort')} · ${t(entry.beta && entry.href ? 'market.betaReady' : `market.entry.${entry.status}`)}`}
    </Badge>
    {entry.beta && app.production.status === 'not-deployed' ? <span className={styles.note}>{t('market.unpublished')}</span> : null}
    {entry.trial ? <span className={styles.note}>Beta · {t(entry.trialHref ? 'market.betaReady' : `market.entry.${entry.trialStatus}`)}</span> : null}
  </div>;
}

export function MarketAppActions({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), entry = marketEntry(app);
  return <ActionRow>
    {entry.href ? <ExternalButtonLink size="small" href={entry.href}>{t(entry.beta ? 'market.tryBeta' : 'market.openShort')}</ExternalButtonLink> : null}
    {entry.trial ? entry.trialHref ? <ExternalButtonLink size="small" href={entry.trialHref}>{t('market.tryBeta')}</ExternalButtonLink>
      : <Button size="small" disabled>{t('market.tryBeta')}</Button> : null}
  </ActionRow>;
}

export function MarketAppNotice({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), date = useDateText(), entry = marketEntry(app), maintenance = app.maintenance;
  return <>
    {maintenance ? <p className={styles.note}>{t('market.maintenance.reason', { reason: maintenance.reason })}{maintenance.expectedEndAt ? ` · ${t('market.maintenance.until', { time: date(maintenance.expectedEndAt) })}` : ''}</p> : null}
    {entry.href && entry.beta || entry.trialHref ? <p className={styles.note}>{t(entry.beta ? 'market.betaData' : 'market.sharedData')}</p> : null}
  </>;
}
