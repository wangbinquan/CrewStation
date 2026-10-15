import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../../apps/console/src/shared/lib/I18nProvider';
import { DialogHost } from '../../../../apps/console/src/shared/ui/dialog/DialogHost';
import { messages as app } from '../../../../apps/console/src/app/i18n/zh-CN';
import { messages as cluster } from '../../../../apps/console/src/features/cluster/i18n/zh-CN';
import { messages as objects } from '../../../../apps/console/src/features/object-storage/i18n/zh-CN';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './styles.css';
import { App } from './App';

const messages = { ...app, ...cluster, ...objects };
document.documentElement.dataset.demoTheme = 'light';
createRoot(document.getElementById('root')!).render(<I18nProvider catalog={{ 'zh-CN': messages, 'en-US': messages }}><DialogHost><App /></DialogHost></I18nProvider>);
