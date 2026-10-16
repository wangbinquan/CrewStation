import { api } from '../../../../shared/api/client';
import { queryKeys } from '../../../../shared/api/queryKeys';
import { errorMessage, useApiQuery } from '../../../../shared/api/useApi';
import { RuntimeImagePicker } from '../../../../shared/runtime-images/RuntimeImagePicker';
import { useT } from '../../../../shared/lib/useT';
import { FormDialog } from '../../../../shared/ui/dialog/FormDialog';
import type { BotOptions } from '../../hooks/bot/useBotDraft';
import { choiceBlocked, choicesFor, resolveChoice } from '../../model/computeChoices';
import { ComputeOptions, computeBlockText } from '../agents/ComputeOptions';
import styles from '../agents/StartAgentForm.module.css';

export function BotOptionsDialog({ projectId, value, onChange, onClose }: {
  readonly projectId: string; readonly value: BotOptions; readonly onChange: (options: BotOptions) => void; readonly onClose: () => void;
}) {
  const t = useT(), compute = value.compute?.kind === 'profile' ? value.compute.profileId : '', image = value.runtimeImageVersionId ?? '';
  const edit = (id: string) => onChange({ ...(id ? { compute: { kind: 'profile', profileId: id }, computeName: choices.find(item => item.id === id)?.name } : {}) });
  const profiles = useApiQuery(queryKeys.computeProfiles(projectId), () => api.catalog.listComputeProfiles(projectId));
  const choices = choicesFor(profiles.data?.items ?? [], 'agent'), selected = resolveChoice(choices, compute), block = choiceBlocked(choices, compute);
  return <FormDialog title={t('devSession.continuous.options')} submitLabel={t('devSession.continuous.applyOptions')} onClose={onClose}
    submitDisabled={!profiles.data || !!block} error={profiles.error ? errorMessage(profiles.error) : computeBlockText(t, block, selected)}
    onSubmit={onClose}>
    <p>{t('devSession.continuous.optionsHint')}</p>
    <div className={styles.row}><label htmlFor="bot-compute">{t('devSession.agents.compute')}</label><select id="bot-compute" value={compute} onChange={event => edit(event.target.value)}><ComputeOptions items={choices} withDescription /></select></div>
    <RuntimeImagePicker projectId={projectId} usage="agent" profileId={selected?.id} value={image} onChange={runtimeImageVersionId => onChange({ ...value, runtimeImageVersionId })} />
  </FormDialog>;
}
