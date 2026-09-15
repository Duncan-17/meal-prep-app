import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/router';
import { ensureDefaults } from '@/db/init';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Seed targets and settings on first run. Idempotent, and deliberately not
// awaited — nothing on screen depends on it, and a slow IndexedDB open should
// not delay first paint.
void ensureDefaults().catch((error: unknown) => {
  console.error('Failed to seed defaults', error);
});

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
