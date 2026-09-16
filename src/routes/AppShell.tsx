import { Outlet } from 'react-router-dom';

import { TabBar } from '@/ui/TabBar';
import { InstallPrompt } from '@/ui/InstallPrompt';
import { useOnline } from '@/ui/useOnline';

export function AppShell() {
  const online = useOnline();

  return (
    <div className="shell">
      {/*
        Offline is a caveat, not a failure: everything except food search reads
        from IndexedDB and works exactly the same with no signal.
      */}
      {!online && (
        <p className="offline" role="status">
          Offline — everything still works except searching for new foods.
        </p>
      )}

      <main className="shell__main">
        <div className="shell__install">
          <InstallPrompt />
        </div>
        <Outlet />
      </main>

      <TabBar />
    </div>
  );
}
