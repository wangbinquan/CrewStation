import type { MarketAppDto } from '@crewstation/contracts';
import { Link } from '@tanstack/react-router';
import { useT } from '../../../../shared/lib/useT';
import { useDateText } from '../../../../shared/lib/useDateText';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import { GlyphIcon } from '../../../../shared/ui/icons/GlyphIcon';
import styles from './Market.module.css';

export function MarketAppStatus({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), production = app.production;
  const active = app.projectState === 'active';
  return <div className={styles.meta}>
    {app.projectState !== 'active' ? <Badge>{t(`market.project.${app.projectState}`)}</Badge> : null}
    <Badge tone={production.status === 'unknown' ? 'warning' : active && production.status === 'deployed' && production.state === 'ready' ? 'success' : 'neutral'}>{t(!active && production.status === 'deployed' ? 'market.productionVersion' : `market.production.${production.status}`)}{production.status === 'deployed' ? ` · ${production.tag}` : ''}</Badge>
    {active && production.status === 'deployed' ? <span>{t(`market.deployment.${production.state}`)}</span> : null}
  </div>;
}

export function MarketAppAccess({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), production = app.production;
  const host = production.status === 'deployed' ? production.host : undefined;
  // Host 由正式槽返回；只接受主机名，避免把 preview 或 arbitrary href 填进应用入口。
  const href = host && /^[a-z\d][a-z\d.-]*(?::\d+)?$/i.test(host) ? `${window.location.protocol === 'https:' ? 'https:' : 'http:'}//${host}` : undefined;
  return <div className={styles.actions}>
    {href && app.projectState === 'active' ? <a href={href} target="_blank" rel="noopener noreferrer">{t('market.open')} ↗</a> : <span>{t('market.notAvailable')}</span>}
    {app.canDevelop ? <Link to="/projects/$projectId" params={{ projectId: app.projectId }}>{t('market.develop')}</Link> : null}
    {app.canConfigure ? <Link to="/projects/$projectId/settings" params={{ projectId: app.projectId }} search={{ tab: 'visibility' }}>{t('market.configure')}</Link> : null}
  </div>;
}

export function MarketAppCard({ app }: { readonly app: MarketAppDto }) {
  const t = useT();
  return <Card compact title={<Link to="/market/$projectId" params={{ projectId: app.projectId }}>{app.name}</Link>} extra={<GlyphIcon name={app.icon} />} footer={<MarketAppAccess app={app} />}>
    <div className={styles.content}><p className={styles.summary}>{app.description || t('market.noDescription')}</p><p className={styles.owner}>{t('market.owner', { name: app.owner.name })}</p><MarketAppStatus app={app} /></div>
  </Card>;
}

export function MarketAppDetail({ app }: { readonly app: MarketAppDto }) {
  const t = useT(), dateText = useDateText();
  return <Card compact title={app.name} extra={<GlyphIcon name={app.icon} />} footer={<MarketAppAccess app={app} />}>
    <div className={styles.content}><p className={styles.description}>{app.description || t('market.noDescription')}</p><p>{t('market.owner', { name: app.owner.name })}</p><MarketAppStatus app={app} />
      {app.production.status === 'deployed' ? <p>{t('market.commit')} <code>{app.production.commitSha}</code></p> : null}
      <p className={styles.owner}>{t('market.checked', { time: dateText(app.production.checkedAt) })}</p><p>{t('market.boundary')}</p>
    </div>
  </Card>;
}
