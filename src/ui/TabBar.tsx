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
      // `#root`'s safe-area padding can't help a fixed child — it's positioned
      // against the viewport, so on a home-indicator phone it sits under the
      // indicator. Each fixed element has to account for the inset itself.
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 w-[min(96%,400px)]"
    >
      <ul className="glass rounded-[28px] px-2 py-1.5 flex items-center justify-between">
        {tabs.map(({ to, icon: Icon, label }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                // Labels, not icons alone: five glyphs with no words makes
                // people guess, and the guess costs a wrong screen every time.
                `flex flex-col items-center justify-center gap-0.5 h-14 w-14 rounded-2xl transition ${
                  isActive
                    ? 'bg-white shadow-[var(--shadow-pill)] text-ink-900'
                    : 'text-ink-600 hover:text-ink-900'
                }`
              }
            >
              <Icon size={20} strokeWidth={1.75} absoluteStrokeWidth />
              <span className="text-[10px] leading-none font-medium">{label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
