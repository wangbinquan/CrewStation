import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../../apps/console/src/shared/lib/I18nProvider';
import { DialogHost } from '../../../../apps/console/src/shared/ui/dialog/DialogHost';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './styles.css';
import { App } from './App';

const messages = { 'ui.dialog.close': '关闭', 'ui.dialog.clear': '清空', 'dialog.close': '关闭', 'dialog.clear': '清空', 'ui.confirm.no': '取消', 'ui.confirm.yes': '确认' };
createRoot(document.getElementById('root')!).render(<I18nProvider catalog={{ 'zh-CN': messages, 'en-US': messages }}><DialogHost><App /></DialogHost></I18nProvider>);
