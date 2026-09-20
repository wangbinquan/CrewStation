import type { OidcProviderDto } from '@crewstation/contracts';
import { useState } from 'react';
import { providerDraft, providerFieldGroup, providerGroups, providerRequest } from '../model/providerDraft';
import type { ProviderDraft, ProviderGroup } from '../model/providerDraft';
import { providerErrors } from '../model/providerValidation';

export function useProviderDraft(initial?: OidcProviderDto) {
  const [value, setValue] = useState(() => providerDraft(initial));
  const [baseline] = useState(() => JSON.stringify(value));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [group, setGroup] = useState<ProviderGroup>('basics'), [attempt, setAttempt] = useState(0);
  const set = <K extends keyof ProviderDraft>(key: K, next: ProviderDraft[K]) => {
    const updated = { ...value, [key]: next };
    setValue(updated);
    if (attempt) setErrors(providerErrors(providerRequest(updated), initial !== undefined));
  };
  const validate = () => {
    const body = providerRequest(value), next = providerErrors(body, initial !== undefined);
    setErrors(next); setAttempt((n) => n + 1);
    const firstGroup = providerGroups.find((name) => Object.keys(next).some((key) => providerFieldGroup(key) === name));
    if (firstGroup) { setGroup(firstGroup); return undefined; }
    return body;
  };
  return { value, set, errors, group, setGroup, attempt, validate, dirty: baseline !== JSON.stringify(value) };
}
export type ProviderDraftState = ReturnType<typeof useProviderDraft>;
