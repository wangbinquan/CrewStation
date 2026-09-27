import { AppIcon } from '../../../../shared/ui/icons/AppIcon';
import { applicationOrigin } from '../../../../shared/ui/icons/appIconSources';
import { marketEntry } from './marketEntry';
import type { MarketAppDto } from '@crewstation/contracts';
import { useT } from '../../../../shared/lib/useT';
import { DefinitionList } from '../../../../shared/ui/DefinitionList';
import { Stack } from '../../../../shared/ui/Stack';
import { Dialog } from '../../../../shared/ui/dialog/Dialog';
import { MarketAppActions, MarketAppNotice, MarketAppStatus } from './MarketAppParts';
import styles from './Market.module.css';

export function MarketAppDetails({ app, onClose }: { readonly app: MarketAppDto; readonly onClose: () => void }) {
  const t = useT();
  return <Dialog title={app.name} onClose={onClose} footer={<MarketAppActions app={app} />}>
    <Stack>
      <AppIcon projectId={app.projectId} icon={app.icon} source={app.iconSource} applicationOrigin={marketEntry(app).href ? applicationOrigin(app.entry.host) : undefined} />
      <p className={styles.description}>{app.description || t('market.noDescription')}</p>
      <DefinitionList items={[{ label: t('market.owner'), value: app.owner.name.trim() || t('market.unknownOwner') }, { label: t('market.status'), value: <MarketAppStatus app={app} /> }]} />
      <MarketAppNotice app={app} />
    </Stack>
  </Dialog>;
}
