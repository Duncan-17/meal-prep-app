/**
 * Online/offline, as React state.
 *
 * `navigator.onLine` is famously optimistic — it reports true for a captive
 * portal or a router with no upstream — so this is used only to *explain* a
 * failure and to soften the food search, never to decide whether the app
 * works. Everything local runs off IndexedDB and does not care either way.
 */

import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
