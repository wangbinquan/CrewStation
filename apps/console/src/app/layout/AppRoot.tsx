import { Outlet } from '@tanstack/react-router';
import { AgentActivityProvider } from '../../shared/activity/AgentActivityProvider';

export function AppRoot() { return <AgentActivityProvider><Outlet /></AgentActivityProvider>; }
