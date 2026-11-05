import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/routes/router';
import { AuthGate } from '@/auth/AuthGate';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// Nothing renders, seeds or syncs until someone is signed in — AuthGate starts
// the defaults and sync once they are (PLAN.md §11).
createRoot(rootEl).render(
  <StrictMode>
    <AuthGate>
      <RouterProvider router={router} />
    </AuthGate>
  </StrictMode>,
);
