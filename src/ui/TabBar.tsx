import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

type Tab = { to: string; label: string; icon: ReactNode };

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const TABS: Tab[] = [
  {
    to: '/calendar',
    label: 'Calendar',
    icon: (
      <svg className="tabbar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="2.5" {...stroke} />
        <path d="M3 10h18M8 3v4M16 3v4" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/components',
    label: 'Recipes',
    icon: (
      <svg className="tabbar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7.5" height="7.5" rx="2" {...stroke} />
        <rect x="13.5" y="3" width="7.5" height="7.5" rx="2" {...stroke} />
        <rect x="3" y="13.5" width="7.5" height="7.5" rx="2" {...stroke} />
        <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/fridge',
    label: 'Fridge',
    icon: (
      <svg className="tabbar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="2.5" width="14" height="19" rx="2.5" {...stroke} />
        <path d="M5 10h14M8.5 6v2M8.5 13v2.5" {...stroke} />
      </svg>
    ),
  },
  {
    to: '/log',
    label: 'Diary',
    icon: (
      <svg className="tabbar__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3.5h10a2 2 0 0 1 2 2v15l-7-3.2-7 3.2v-15a2 2 0 0 1 2-2Z" {...stroke} />
        <path d="M9.5 8.5h5" {...stroke} />
      </svg>
    ),
  },
];

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink key={tab.to} to={tab.to} className="tabbar__link">
          {tab.icon}
          <span>{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
