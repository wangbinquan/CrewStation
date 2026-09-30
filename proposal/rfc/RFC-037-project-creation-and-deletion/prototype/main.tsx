import { createRoot } from 'react-dom/client';
import { I18nProvider } from '../../../../apps/console/src/shared/lib/I18nProvider';
import { DialogHost } from '../../../../apps/console/src/shared/ui/dialog/DialogHost';
import '../../../../apps/console/src/app/theme/tokens.css';
import '../../../../apps/console/src/app/theme/base.css';
import './styles.css';
import { App } from './App';

const zh = { 'ui.dialog.close': '关闭', 'ui.dialog.clear': '清空', 'ui.confirm.no': '取消', 'ui.dialog.typeToConfirm': '输入 {word} 确认' };
const en = { 'ui.dialog.close': 'Close', 'ui.dialog.clear': 'Clear', 'ui.confirm.no': 'Cancel', 'ui.dialog.typeToConfirm': 'Type {word} to confirm' };
createRoot(document.getElementById('root')!).render(<I18nProvider catalog={{ 'zh-CN': zh, 'en-US': en }}><DialogHost><App /></DialogHost></I18nProvider>);
