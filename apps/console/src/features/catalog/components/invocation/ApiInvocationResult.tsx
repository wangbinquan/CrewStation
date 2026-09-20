import { useT } from '../../../../shared/lib/useT';
import { Badge } from '../../../../shared/ui/Badge';
import { Card } from '../../../../shared/ui/Card';
import type { ApiInvocationOutcome } from '../../hooks/useApiInvocation';
import styles from './ApiInvocation.module.css';

export function ApiInvocationResult({ outcome }: { readonly outcome: ApiInvocationOutcome }) {
  const t = useT(), { result } = outcome.response;
  return <Card compact title={t('catalog.invoke.result')}>
    <div className={styles.summary}><Badge tone={result.status >= 400 ? 'warning' : 'info'}>HTTP {result.status}</Badge><span>{t('catalog.invoke.duration', { ms: result.durationMs })}</span><code>{outcome.request.operationId}</code></div>
    <p className={styles.note}>{t('catalog.invoke.resultTask')} <code>{outcome.response.taskId}</code></p>
    {result.bodyTruncated || result.headersTruncated ? <p role="status">{t('catalog.invoke.truncated', { parts: [result.bodyTruncated ? t('catalog.invoke.responseBody') : '', result.headersTruncated ? t('catalog.invoke.responseHeaders') : ''].filter(Boolean).join(' / ') })}</p> : null}
    <p className={styles.note}>{t('catalog.invoke.textView')}</p>
    <pre className={styles.output} aria-label={t('catalog.invoke.responseBody')}>{result.body || t('catalog.invoke.emptyBody')}</pre>
    <details><summary>{t('catalog.invoke.responseHeaders')}</summary><pre className={styles.output}>{JSON.stringify(result.headers, null, 2)}</pre></details>
    <details><summary>{t('catalog.invoke.sentRequest')}</summary><pre className={styles.output}>{JSON.stringify(outcome.request, null, 2)}</pre></details>
  </Card>;
}
