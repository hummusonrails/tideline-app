import { NavLink } from 'react-router-dom';
import { Home, Calendar, Camera, MessageCircle, Trophy } from 'lucide-react';

const tabs = [
  { to: '/today', icon: Home,           label: 'Today' },
  { to: '/itinerary', icon: Calendar,   label: 'Itinerary' },
  { to: '/photos', icon: Camera,        label: 'Photos' },
  { to: '/chat', icon: MessageCircle,   label: 'Chat' },
  { to: '/quest', icon: Trophy,         label: 'Quest' },
];

export function TabBar() {
  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 w-[min(96%,400px)]"
    >
      <ul className="glass rounded-full px-2 py-2 flex items-center justify-between">
        {tabs.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                `grid h-12 w-12 place-items-center rounded-full transition ${
                  isActive
                    ? 'bg-white shadow-[var(--shadow-pill)] text-ink-900'
                    : 'text-ink-600 hover:text-ink-900'
                }`
              }
              aria-label={label}
            >
              <Icon size={22} strokeWidth={1.75} absoluteStrokeWidth />
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
