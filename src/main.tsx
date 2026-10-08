import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/router';
import { ensureDefaults } from '@/db/init';
import { startSync } from '@/db/sync';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Seed targets and settings on first run, then start syncing. Idempotent, and
// deliberately not awaited — nothing on screen depends on it, and a slow
// IndexedDB open should not delay first paint. Sync starts AFTER the seeds so
// its first scan sees them (and stamps them 0, so they lose to real goals
// already in the database — see `ownTimestamp`).
void ensureDefaults()
  .catch((error: unknown) => {
    console.error('Failed to seed defaults', error);
  })
  .then(() => startSync());

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
