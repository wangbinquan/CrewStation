// 工作台入口：挂载 Provider 与路由；业务页面在 features/*，路由骨架在 app/router。
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders } from './app/providers/AppProviders';
import { router } from './app/router/router';
import './app/theme/tokens.css';
import './app/theme/base.css';

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
