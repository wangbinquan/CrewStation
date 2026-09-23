import type { MarketAppDto } from '@crewstation/contracts';
import { useDateText } from '../../../../shared/lib/useDateText';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import { marketHref } from './marketHref';
import styles from './Market.module.css';
import { ExternalButtonLink } from '../../../../shared/ui/navigation/ButtonLink';

/** 市场卡片；正式版本维护中时带「维护中」与原因，被网关拦住的人没有打开入口（RFC-021 M13）。 */
export function MarketAppCard({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), date = useDateText(), maintenance = app.maintenance;
  const href = app.entry.status === 'ready' && !maintenance?.blocked ? marketHref(app.entry.host) : undefined;
  const beta = app.entry.kind === 'trial';
  const trial = app.canPreview && app.production.status === 'deployed' ? app.trial : undefined;
  const trialHref = trial?.status === 'ready' ? marketHref(trial.host) : undefined;
  const status = app.entry.status === 'unknown' ? 'unknown' : 'unavailable';
  return <Card className={styles.appCard} footer={trial ? <div className={styles.trial}>
    {trialHref ? <ExternalButtonLink size="small" href={trialHref}>{t('market.trialTitle')}</ExternalButtonLink>
      : <span>{t('market.trialTitle')} · {t(`market.entry.${trial.status === 'unknown' ? 'unknown' : 'unavailable'}`)}</span>}
    <p className={styles.note}>{t('market.sharedData')}</p>
  </div> : undefined}>
    <div className={styles.content}>
      <div className={styles.heading}>
        <div className={styles.appIcon}><GlyphIcon name={app.icon} /></div>
        <h2 className={styles.name}>{href ? <a className={styles.appLink} href={href} target="_blank" rel="noopener noreferrer">{app.name}</a> : app.name}</h2>
        {beta ? <Badge tone="info">Beta</Badge> : null}
        {maintenance ? <Badge tone="warning">{t('market.maintenance.badge')}</Badge> : null}
      </div>
      {app.description ? <p className={styles.summary}>{app.description}</p> : null}
      {maintenance ? <p className={styles.note}>{t('market.maintenance.reason', { reason: maintenance.reason })}{maintenance.expectedEndAt ? ` · ${t('market.maintenance.until', { time: date(maintenance.expectedEndAt) })}` : ''}</p> : null}
      {beta ? <p className={styles.note}>{t('market.sharedData')}</p> : null}
      <div className={styles.entry}>{href
        ? <span className={styles.open}>{t(beta ? 'market.try' : 'market.open')}</span>
        : maintenance?.blocked ? <Badge tone="warning">{t('market.maintenance.blocked')}</Badge>
        : <Badge tone={status === 'unknown' ? 'warning' : 'neutral'}>{t(`market.entry.${status}`)}</Badge>}
      </div>
    </div>
  </Card>;
}
