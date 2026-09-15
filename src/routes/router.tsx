import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '@/routes/AppShell';
import { CalendarScreen } from '@/features/calendar/CalendarScreen';
import { ComponentLibraryScreen } from '@/features/components/ComponentLibraryScreen';
import { ComponentBuilder } from '@/features/components/ComponentBuilder';
import { ComponentDetail } from '@/features/components/ComponentDetail';
import { FridgeScreen } from '@/features/fridge/FridgeScreen';
import { LogScreen } from '@/features/log/LogScreen';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/calendar" replace /> },
      { path: 'calendar', element: <CalendarScreen /> },
      { path: 'components', element: <ComponentLibraryScreen /> },
      // `new` before `:id` — otherwise it parses as a Component with id "new".
      { path: 'components/new', element: <ComponentBuilder /> },
      { path: 'components/:id', element: <ComponentDetail /> },
      { path: 'components/:id/edit', element: <ComponentBuilder /> },
      { path: 'fridge', element: <FridgeScreen /> },
      { path: 'log', element: <LogScreen /> },
    ],
  },
]);
