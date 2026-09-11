import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createQueryClient } from '../../shared/api/queryClient';
import { I18nProvider } from '../../shared/lib/I18nProvider';
import { MESSAGE_CATALOG } from '../i18n/messageCatalog';

/** 全局 Provider：React Query 客户端与界面语言。 */
export function AppProviders({ children }: { readonly children: ReactNode }): ReactElement {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider catalog={MESSAGE_CATALOG}>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
