import { RuntimeExportSchema, type RuntimeStatisticsQuery } from '@crewstation/contracts';
import { useState } from 'react';
import { api } from '../../../shared/api/client';
import { errorMessage, useApiMutation } from '../../../shared/api/useApi';
import { useT } from '../../../shared/lib/useT';
import { Button } from '../../../shared/ui/Button';
import { Stack } from '../../../shared/ui/Stack';
import type { RuntimeSearch } from '../model/runtimeSearch';

export function RuntimeExportButton({ projectId, window, search, disabled }: { projectId?: string; window: RuntimeStatisticsQuery; search: RuntimeSearch; disabled: boolean }) {
  const t = useT(), [receipt, setReceipt] = useState<string>();
  const request = { window, view: search.tab === 'agents' ? 'agents' as const : 'tasks' as const, q: search.q, state: search.state, quality: search.quality, agent: search.agent };
  const exportFile = useApiMutation(async () => {
    const result = RuntimeExportSchema.parse(await (projectId ? api.observability.projectRuntimeExport(projectId, request) : api.observability.systemRuntimeExport(request)));
    const url = URL.createObjectURL(new Blob([result.content], { type: result.mediaType })), link = document.createElement('a');
    link.href = url; link.download = result.filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return result;
  }, { onSuccess: (result) => setReceipt(t(result.partial ? 'runtime.exportPartial' : 'runtime.exportComplete', { count: result.rows })) });
  return <Stack><Button disabled={disabled || exportFile.isPending} onClick={() => { setReceipt(undefined); exportFile.mutate(); }}>{t(exportFile.isPending ? 'runtime.exporting' : 'runtime.export')}</Button>
    {exportFile.error ? <p role="alert">{errorMessage(exportFile.error)}</p> : receipt ? <p role="status">{receipt}</p> : null}
  </Stack>;
}
