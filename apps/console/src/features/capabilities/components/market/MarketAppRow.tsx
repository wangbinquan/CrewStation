import type { MarketAppDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { Button } from '../../../../shared/ui/Button';
import { Badge } from '../../../../shared/ui/Badge';
import { AppIcon } from '../../../../shared/ui/icons/AppIcon';
import { applicationOrigin } from '../../../../shared/ui/icons/appIconSources';
import { MarketAppActions, MarketAppNotice, MarketAppStatus } from './MarketAppParts';
import { marketEntry } from './marketEntry';
import styles from './Market.module.css';

export function MarketAppRow({ app, onOwner, onDetails }: { readonly app: MarketAppDto; readonly onOwner: (app: MarketAppDto) => void; readonly onDetails: () => void }) {
  const t = useT(), entry = marketEntry(app), name = app.owner.name.trim();
  return <tr>
    <td className={styles.capability}>
      <div className={styles.heading}><AppIcon projectId={app.projectId} icon={app.icon} source={app.iconSource} applicationOrigin={entry.href ? applicationOrigin(app.entry.host) : undefined} />
        <h2 className={styles.name}>{entry.href ? <a href={entry.href} target="_blank" rel="noopener noreferrer">{app.name}</a> : app.name}</h2>
        {entry.beta ? <Badge tone="info">Beta</Badge> : null}
      </div>
      <p className={styles.summary}>{app.description || t('market.noDescription')}</p>
      <MarketAppNotice app={app} />
    </td>
    <td className={styles.owner} data-label={t('market.owner')}>{name ? <Button size="small" onClick={() => onOwner(app)} aria-label={t('market.byOwner', { name })}>{name}</Button> : <span className={styles.note}>{t('market.unknownOwner')}</span>}</td>
    <td className={styles.state}><MarketAppStatus app={app} /></td>
    <td className={styles.actions}><div className={styles.actionControls}><MarketAppActions app={app} /><Button size="small" onClick={onDetails} aria-label={t('market.detailsFor', { name: app.name })}>{t('market.details')}</Button></div></td>
  </tr>;
}
