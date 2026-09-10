import { Outlet } from 'react-router-dom';
import { TabBar } from '@/ui/TabBar';

export function AppShell() {
  return (
    <div className="shell">
      <main className="shell__main">
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
