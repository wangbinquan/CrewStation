import { useDateText } from '../../../../../shared/lib/useDateText';
import { useT } from '../../../../../shared/lib/useT';
import { ActionNote } from '../../../../../shared/ui/ActionNote';
import { CopyButton } from '../../../../../shared/ui/clipboard/CopyButton';
import { Badge } from '../../../../../shared/ui/Badge';
import type { ProviderProbe } from '../../../hooks/useProviderProbe';
import styles from '../IdentityAdmin.module.css';

export function ProviderProbePanel({ probe, stale }: { readonly probe: ProviderProbe; readonly stale: boolean }) {
  const t = useT(), dateText = useDateText(), result = probe.result;
  return <div className={styles.probe} role="status" aria-live="polite">
    <div className={styles.sectionHeading}><strong>{t('admin.identity.probeTitle')}</strong>
      <Badge tone={stale ? 'warning' : probe.pending ? 'neutral' : result?.ok ? 'success' : 'danger'}>{t(stale ? 'admin.identity.probeStale' : probe.pending ? 'admin.auth.testing' : result?.ok ? 'admin.auth.probeOk' : 'admin.auth.probeNotOk')}</Badge>
    </div>
    {stale ? <p className={styles.muted}>{t('admin.identity.probeStaleHint')}</p> : null}
    {probe.error ? <ActionNote tone="error">{probe.error.message} {t('admin.identity.http', { status: probe.error.status })}</ActionNote> : null}
    {result ? <>
      <div className={styles.meta}><span>{t(result.discovery.ok ? 'admin.auth.probeDiscoveryOk' : 'admin.auth.probeDiscoveryFailed')}</span><span>JWKS · {t(result.jwksReachable === undefined ? 'admin.identity.notTested' : result.jwksReachable ? 'admin.auth.probeReachable' : 'admin.auth.probeUnreachable')}</span></div>
      {result.discovery.error ? <ActionNote tone="error">{result.discovery.error}</ActionNote> : null}
      <dl className={styles.endpoint}><dt>{t('admin.auth.issuerUrl')}</dt><dd><code>{result.issuer}</code><CopyButton value={result.issuer} /></dd></dl>
      <dl className={styles.endpoint}>{Object.entries(result.endpoints).map(([key, endpoint]) => <div key={key} style={{ display: 'contents' }}><dt>{t(`admin.auth.${key}`)}</dt><dd>{endpoint ? <><Badge>{t(`admin.identity.source.${endpoint.source}`)}</Badge><code>{endpoint.url}</code><CopyButton value={endpoint.url} /></> : <span>{t('admin.auth.probeMissing')}</span>}</dd></div>)}</dl>
      <p className={styles.muted}>{t('admin.identity.supportedScopes')} · {result.scopesSupported.join(' · ') || t('admin.identity.notReported')}</p>
      <p className={styles.muted}>{t('admin.identity.testedAt', { time: dateText(probe.completedAt) })}</p>
    </> : null}
  </div>;
}
