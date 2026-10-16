import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../../apps/console/src/shared/lib/I18nProvider';
import { DialogHost } from '../../../../apps/console/src/shared/ui/dialog/DialogHost';
import { messages as app } from '../../../../apps/console/src/app/i18n/zh-CN';
import { messages as dev } from '../../../../apps/console/src/features/dev-session/i18n/zh-CN';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './prototype.css';
import { App } from './App';

const messages = { ...app, ...dev, 'devSession.bot.stop': '停止本轮' };
createRoot(document.getElementById('root')!).render(<I18nProvider catalog={{ 'zh-CN': messages, 'en-US': messages }}><DialogHost><App /></DialogHost></I18nProvider>);
