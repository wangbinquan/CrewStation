import type { MarketAppDto } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import { MarketTrial } from './MarketTrial';
import { marketHref } from './marketHref';
import styles from './Market.module.css';

export function MarketAppStatus({ app }: { readonly app: MarketAppDto }) {
  const t = useT();
  return <div className={styles.meta}>
    {app.entry.kind === 'trial' ? <Badge tone="info">Beta</Badge> : null}
    <Badge tone={app.entry.status === 'ready' ? 'success' : app.entry.status === 'unknown' ? 'warning' : 'neutral'}>{t(`market.entry.${app.entry.status}`)}</Badge>
  </div>;
}

export function MarketAppAccess({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), href = app.entry.status === 'ready' ? marketHref(app.entry.host) : undefined;
  return <div>
    {app.entry.kind === 'trial' ? <p className={styles.owner}>{t('market.sharedData')}</p> : null}
    <div className={styles.actions}>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{t(app.entry.kind === 'trial' ? 'market.try' : 'market.open')} ↗</a> : <span>{t('market.notAvailable')}</span>}</div>
  </div>;
}

export function MarketAppCard({ app }: { readonly app: MarketAppDto }) {
  const t = useT();
  return <Card compact title={<Link to="/market/$projectId" params={{ projectId: app.projectId }}>{app.name}</Link>} extra={<GlyphIcon name={app.icon} />} footer={<MarketAppAccess app={app} />}>
    <div className={styles.content}><p className={styles.summary}>{app.description || t('market.noDescription')}</p><p className={styles.owner}>{t('market.owner', { name: app.owner.name })}</p><MarketAppStatus app={app} /></div>
  </Card>;
}

export function MarketAppDetail({ app }: { readonly app: MarketAppDto }) {
  const t = useT();
  return <>
    <Card compact title={app.name} extra={<GlyphIcon name={app.icon} />} footer={<MarketAppAccess app={app} />}>
      <div className={styles.content}><p className={styles.description}>{app.description || t('market.noDescription')}</p><p>{t('market.owner', { name: app.owner.name })}</p><MarketAppStatus app={app} /></div>
    </Card>
    {app.canPreview && app.production.status === 'deployed' ? <MarketTrial projectId={app.projectId} /> : null}
  </>;
}
